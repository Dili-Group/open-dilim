// Test message-ingest: gateway + ZaloIngestor + trigger gate + dedupe. Port mock, không I/O thật.

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import type { ZaloChannelConfig } from "../config.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { ChannelFactory } from "./factory.ts";
import { createGateway } from "./gateway.ts";
import { isAddressed } from "./ingestor.ts";
import { ZaloIngestor } from "./adapters/zalo.ts";
import type { IngestDeps } from "./deps.ts";

const AGENT_UID = "AGENT";
const SECRET = "sekret";
const CHANNEL_CONFIG: ZaloChannelConfig = { agentUid: AGENT_UID, webhookSecret: SECRET };

/** Deps mock ghi lại call. broker.publish có thể ép fail để test release + 5xx. */
function makeDeps(opts: { failPublish?: boolean } = {}) {
  const published: Envelope[] = [];
  const history: HistoryEntry[] = [];
  const seen = new Set<string>();
  const released: string[] = [];
  const deps: IngestDeps = {
    broker: {
      async publish(e) {
        if (opts.failPublish) throw new Error("broker down");
        published.push(e);
      },
    },
    history: {
      async append(e) {
        history.push(e);
      },
    },
    dedupe: {
      async firstSee(channel, msgId) {
        const key = `${channel}:${msgId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
      async release(channel, msgId) {
        const key = `${channel}:${msgId}`;
        seen.delete(key);
        released.push(key);
      },
    },
  };
  return { deps, published, history, released };
}

function makeGateway(deps: IngestDeps) {
  const factory = new ChannelFactory().register(new ZaloIngestor(CHANNEL_CONFIG));
  return createGateway(factory, deps);
}

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

/** Request tới /webhook/zalo với chữ ký hợp lệ (trừ khi override). */
function webhook(payload: unknown, over: { signature?: string } = {}): Request {
  const body = JSON.stringify(payload);
  return new Request("http://x/webhook/zalo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-zevent-signature": over.signature ?? sign(body),
    },
    body,
  });
}

/** Event Zalo tối thiểu. idTo = AGENT_UID → direct; khác → group. */
function event(over: Record<string, unknown>): Record<string, unknown> {
  return { msgId: "m1", uidFrom: "U1", idTo: "G1", content: "xin chào", ts: "1700000000000", ...over };
}

describe("isAddressed (trigger gate)", () => {
  test("direct luôn nhắm agent", () => {
    expect(isAddressed(false, "hi", [], AGENT_UID)).toBe(true);
  });
  test("group không mention/không lệnh → false", () => {
    expect(isAddressed(true, "hi", [], AGENT_UID)).toBe(false);
  });
  test("group mention @agent → true", () => {
    expect(isAddressed(true, "hi", [{ uid: AGENT_UID }], AGENT_UID)).toBe(true);
  });
  test("group /lệnh (không mention) → true", () => {
    expect(isAddressed(true, "/ketnoi-hethong X", [], AGENT_UID)).toBe(true);
  });
});

describe("gateway", () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  test("group chatter → history, KHÔNG publish (200)", async () => {
    const gw = makeGateway(ctx.deps);
    const res = await gw.handle(webhook(event({ mentions: [] })));
    expect(res.status).toBe(200);
    expect(ctx.history).toHaveLength(1);
    expect(ctx.published).toHaveLength(0);
  });

  test("group mention @agent → publish + history, addressedToAgent=true", async () => {
    const gw = makeGateway(ctx.deps);
    const res = await gw.handle(webhook(event({ mentions: [{ uid: AGENT_UID, pos: 0, len: 5, type: 1 }] })));
    expect(res.status).toBe(200);
    expect(ctx.published).toHaveLength(1);
    expect(ctx.published[0]?.addressedToAgent).toBe(true);
    expect(ctx.published[0]?.isGroup).toBe(true);
    expect(ctx.published[0]?.conversationId).toBe("G1");
  });

  test("group /lệnh → publish dù không mention", async () => {
    const gw = makeGateway(ctx.deps);
    const res = await gw.handle(webhook(event({ content: "/ketnoi-hethong TOKEN" })));
    expect(res.status).toBe(200);
    expect(ctx.published).toHaveLength(1);
  });

  test("direct (idTo=agentUid) → publish, conversationId=uidFrom", async () => {
    const gw = makeGateway(ctx.deps);
    const res = await gw.handle(webhook(event({ idTo: AGENT_UID, uidFrom: "U9" })));
    expect(res.status).toBe(200);
    expect(ctx.published[0]?.isGroup).toBe(false);
    expect(ctx.published[0]?.conversationId).toBe("U9");
  });

  test("dedupe: cùng msgId 2 lần → publish 1 lần", async () => {
    const gw = makeGateway(ctx.deps);
    const p = event({ mentions: [{ uid: AGENT_UID }] });
    await gw.handle(webhook(p));
    await gw.handle(webhook(p));
    expect(ctx.published).toHaveLength(1);
    expect(ctx.history).toHaveLength(1);
  });

  test("chữ ký sai → 401, không đụng deps", async () => {
    const gw = makeGateway(ctx.deps);
    const res = await gw.handle(webhook(event({}), { signature: "deadbeef" }));
    expect(res.status).toBe(401);
    expect(ctx.history).toHaveLength(0);
    expect(ctx.published).toHaveLength(0);
  });

  test("publish fail → release dedupe + 500 (retry an toàn)", async () => {
    const failCtx = makeDeps({ failPublish: true });
    const gw = makeGateway(failCtx.deps);
    const res = await gw.handle(webhook(event({ msgId: "mf", mentions: [{ uid: AGENT_UID }] })));
    expect(res.status).toBe(500);
    expect(failCtx.released).toEqual(["zalo:mf"]);
  });

  test("kênh lạ → 404", async () => {
    const gw = makeGateway(ctx.deps);
    const req = new Request("http://x/webhook/telegram", {
      method: "POST",
      headers: { "x-zevent-signature": "x" },
      body: "{}",
    });
    expect((await gw.handle(req)).status).toBe(404);
  });

  test("JSON hỏng → 400", async () => {
    const gw = makeGateway(ctx.deps);
    const body = "{ broken";
    const req = new Request("http://x/webhook/zalo", {
      method: "POST",
      headers: { "x-zevent-signature": sign(body) },
      body,
    });
    expect((await gw.handle(req)).status).toBe(400);
  });
});
