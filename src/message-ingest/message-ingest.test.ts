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

/** Vạch người nói giả — trả người nói trước rồi ghi đè, đúng semantics GETSET. */
class FakeSpeakerTracker {
  private readonly last = new Map<string, string>();
  swap(channel: string, conversationId: string, senderId: string): Promise<string | undefined> {
    const key = `${channel}:${conversationId}`;
    const previous = this.last.get(key);
    this.last.set(key, senderId);
    return Promise.resolve(previous);
  }
}

/** Deps mock ghi lại call. broker.publish có thể ép fail để test release + 5xx. */
function makeDeps(opts: { failPublish?: boolean; speakers?: FakeSpeakerTracker } = {}) {
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
    speakers: opts.speakers,
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
  const factory = new ChannelFactory().register(new ZaloIngestor("zalo", CHANNEL_CONFIG));
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

  test("senderName → vào history; payload thiếu tên thì không có field", async () => {
    const gw = makeGateway(ctx.deps);
    await gw.handle(webhook(event({ msgId: "n1", senderName: "  Chị Lan  " })));
    await gw.handle(webhook(event({ msgId: "n2" })));
    expect(ctx.history[0]?.senderName).toBe("Chị Lan");
    expect(ctx.history[1]?.senderName).toBeUndefined();
  });

  test("tên rác dài → cắt trần 40 ký tự", async () => {
    const gw = makeGateway(ctx.deps);
    await gw.handle(webhook(event({ senderName: "x".repeat(200) })));
    expect(ctx.history[0]?.senderName).toHaveLength(40);
  });

  test("cùng một người nói tiếp → KHÔNG đẩy envelope distill", async () => {
    const local = makeDeps({ speakers: new FakeSpeakerTracker() });
    const gw = makeGateway(local.deps);
    await gw.handle(webhook(event({ msgId: "s1", uidFrom: "U1" })));
    await gw.handle(webhook(event({ msgId: "s2", uidFrom: "U1" })));
    expect(local.published).toHaveLength(0);
  });

  test("người KHÁC đáp lại → đẩy envelope distill (dù tin không nhắm agent)", async () => {
    const local = makeDeps({ speakers: new FakeSpeakerTracker() });
    const gw = makeGateway(local.deps);
    await gw.handle(webhook(event({ msgId: "s1", uidFrom: "U1" })));
    await gw.handle(webhook(event({ msgId: "s2", uidFrom: "U1" })));
    await gw.handle(webhook(event({ msgId: "s3", uidFrom: "U2" })));

    expect(local.published).toHaveLength(1);
    expect(local.published[0]).toMatchObject({
      source: "distill",
      msgId: "distill:s3",
      conversationId: "G1",
      addressedToAgent: false,
      text: "",
    });
    // Tin chatter vẫn KHÔNG vào queue agent: chỉ có đúng envelope distill.
    expect(local.history).toHaveLength(3);
  });

  test("tin NHẮM agent → không đẩy distill (cuối lượt agent tự chưng cất)", async () => {
    const local = makeDeps({ speakers: new FakeSpeakerTracker() });
    const gw = makeGateway(local.deps);
    await gw.handle(webhook(event({ msgId: "s1", uidFrom: "U1" })));
    await gw.handle(
      webhook(event({ msgId: "s2", uidFrom: "U2", mentions: [{ uid: AGENT_UID }] })),
    );
    expect(local.published.map((e) => e.source)).toEqual(["channel"]);
  });

  test("vạch người nói hỏng → tin vẫn xử lý bình thường (200, history đủ)", async () => {
    const local = makeDeps({
      speakers: {
        swap: () => Promise.reject(new Error("redis chết")),
      } as unknown as FakeSpeakerTracker,
    });
    const gw = makeGateway(local.deps);
    const res = await gw.handle(webhook(event({ msgId: "s1", uidFrom: "U1" })));
    expect(res.status).toBe(200);
    expect(local.history).toHaveLength(1);
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

  test("nhiều tài khoản Zalo → Envelope mang ĐÚNG tên kênh của adapter nhận tin", async () => {
    // Cùng một adapter class, hai kênh khác nhau: channel là thứ định tuyến root agent nên
    // KHÔNG được hard-code trong adapter.
    const factory = new ChannelFactory()
      .register(new ZaloIngestor("zalo", CHANNEL_CONFIG))
      .register(new ZaloIngestor("zalo-sep", CHANNEL_CONFIG));
    const gw = createGateway(factory, ctx.deps);

    const body = JSON.stringify(event({ msgId: "ms", mentions: [{ uid: AGENT_UID }] }));
    const res = await gw.handle(
      new Request("http://x/webhook/zalo-sep", {
        method: "POST",
        headers: { "x-zevent-signature": sign(body) },
        body,
      }),
    );

    expect(res.status).toBe(200);
    expect(ctx.published.at(-1)?.channel).toBe("zalo-sep");
  });
});
