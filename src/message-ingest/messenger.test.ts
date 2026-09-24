// Test adapter Messenger (Graph API v26.0): parser, chữ ký `sha256=`, bắt tay GET, đường qua gateway.

import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { MessengerChannelConfig } from "../config.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { MessengerIngestor, parseMessengerPayload } from "./adapters/messenger.ts";
import type { IngestDeps } from "./deps.ts";
import { ChannelFactory } from "./factory.ts";
import { createGateway } from "./gateway.ts";

const PAGE_ID = "PAGE1";
const PSID = "PSID1";

function webhook(...messaging: unknown[]) {
  return { object: "page", entry: [{ id: PAGE_ID, time: 1, messaging }] };
}

function event(fields: Record<string, unknown>) {
  return { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1700000000000, ...fields };
}

describe("parseMessengerPayload", () => {
  test("tin text → ParsedMessage 1-1, nhắm agent", () => {
    const out = parseMessengerPayload("meta", PAGE_ID, webhook(event({ message: { mid: "m1", text: "giá bao nhiêu" } })));
    expect(out).toEqual([
      {
        channel: "meta",
        msgId: "m1",
        conversationId: PSID,
        senderId: PSID,
        isGroup: false,
        addressedToAgent: true,
        text: "giá bao nhiêu",
        mentions: [],
        ts: 1700000000000,
      },
    ]);
  });

  test("ảnh đính kèm → imageUrl, text rỗng", () => {
    const out = parseMessengerPayload(
      "meta",
      PAGE_ID,
      webhook(event({ message: { mid: "m2", attachments: [{ type: "image", payload: { url: "https://cdn.fb/a.jpg" } }] } })),
    );
    expect(out[0]?.imageUrl).toBe("https://cdn.fb/a.jpg");
    expect(out[0]?.text).toBe("");
  });

  test("file tài liệu → fileUrl; file đuôi lạ bỏ qua", () => {
    const pdf = parseMessengerPayload(
      "meta",
      PAGE_ID,
      webhook(event({ message: { mid: "m3", attachments: [{ type: "file", payload: { url: "https://cdn.fb/don.pdf" } }] } })),
    );
    expect(pdf[0]?.fileUrl).toBe("https://cdn.fb/don.pdf");

    const zip = parseMessengerPayload(
      "meta",
      PAGE_ID,
      webhook(event({ message: { mid: "m4", attachments: [{ type: "file", payload: { url: "https://cdn.fb/x.zip" } }] } })),
    );
    expect(zip[0]?.fileUrl).toBeUndefined();
  });

  test("echo của page → rơi", () => {
    const out = parseMessengerPayload("meta", PAGE_ID, webhook(event({ message: { mid: "m5", text: "dạ", is_echo: true } })));
    expect(out).toEqual([]);
  });

  test("postback → text là chữ trên nút", () => {
    const out = parseMessengerPayload(
      "meta",
      PAGE_ID,
      webhook(event({ postback: { mid: "p1", title: "Bắt đầu", payload: "GET_STARTED" } })),
    );
    expect(out[0]?.msgId).toBe("p1");
    expect(out[0]?.text).toBe("Bắt đầu");
  });

  test("delivery/read → rơi; nhiều event trong một webhook → giữ tin", () => {
    const out = parseMessengerPayload(
      "meta",
      PAGE_ID,
      webhook(
        event({ delivery: { mids: ["m1"], watermark: 1 } }),
        event({ read: { watermark: 1 } }),
        event({ message: { mid: "m6", text: "a" } }),
      ),
    );
    expect(out.map((m) => m.msgId)).toEqual(["m6"]);
  });

  test("object khác page / shape rác → []", () => {
    expect(parseMessengerPayload("meta", PAGE_ID, { object: "instagram", entry: [] })).toEqual([]);
    expect(parseMessengerPayload("meta", PAGE_ID, null)).toEqual([]);
    expect(parseMessengerPayload("meta", PAGE_ID, { object: "page", entry: "x" })).toEqual([]);
  });
});

describe("parseMessengerPayload — lọc page", () => {
  test("tin gửi tới page khác → rơi", () => {
    const other = { sender: { id: PSID }, recipient: { id: "PAGE-KHAC" }, timestamp: 1, message: { mid: "x", text: "a" } };
    expect(parseMessengerPayload("meta", PAGE_ID, webhook(other))).toEqual([]);
  });
});

const APP_SECRET = "app-secret";
const VERIFY_TOKEN = "verify-me";
const CONFIG: MessengerChannelConfig = {
  platform: "messenger",
  agentUid: PAGE_ID,
  selfUid: PAGE_ID,
  appSecret: APP_SECRET,
  verifyToken: VERIFY_TOKEN,
};
const ingestor = new MessengerIngestor("meta", CONFIG);

function signedHeaders(rawBody: string, secret = APP_SECRET): Headers {
  const hex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return new Headers({ "x-hub-signature-256": `sha256=${hex}` });
}

describe("MessengerIngestor.verify", () => {
  const raw = JSON.stringify(webhook(event({ message: { mid: "m1", text: "a" } })));

  test("chữ ký đúng → pass", () => {
    expect(ingestor.verify(signedHeaders(raw), raw)).toBe(true);
  });

  test("sai secret / body bị sửa / thiếu header → fail", () => {
    expect(ingestor.verify(signedHeaders(raw, "sai"), raw)).toBe(false);
    expect(ingestor.verify(signedHeaders(raw), raw + " ")).toBe(false);
    expect(ingestor.verify(new Headers(), raw)).toBe(false);
  });
});

describe("gateway + kênh Messenger", () => {
  function makeDeps() {
    const published: Envelope[] = [];
    const history: HistoryEntry[] = [];
    const seen = new Set<string>();
    const deps: IngestDeps = {
      broker: {
        publish(envelope) {
          published.push(envelope);
          return Promise.resolve();
        },
      },
      history: {
        append(entry) {
          history.push(entry);
          return Promise.resolve();
        },
      },
      dedupe: {
        firstSee(channel, msgId) {
          const key = `${channel}:${msgId}`;
          if (seen.has(key)) return Promise.resolve(false);
          seen.add(key);
          return Promise.resolve(true);
        },
        release(channel, msgId) {
          seen.delete(`${channel}:${msgId}`);
          return Promise.resolve();
        },
      },
    };
    return { deps, published, history };
  }

  const factory = new ChannelFactory().register(ingestor);

  function handshake(query: string) {
    return createGateway(factory, makeDeps().deps).handle(new Request(`http://x/webhook/meta?${query}`));
  }

  test("GET bắt tay đúng verify_token → echo hub.challenge", async () => {
    const res = await handshake(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  test("GET sai verify_token → 403", async () => {
    const res = await handshake("hub.mode=subscribe&hub.verify_token=sai&hub.challenge=12345");
    expect(res.status).toBe(403);
  });

  test("POST chữ ký đúng → 200 và vào queue", async () => {
    const { deps, published, history } = makeDeps();
    const raw = JSON.stringify(webhook(event({ message: { mid: "m1", text: "giá sao em" } })));
    const res = await createGateway(factory, deps).handle(
      new Request("http://x/webhook/meta", { method: "POST", body: raw, headers: signedHeaders(raw) }),
    );
    expect(res.status).toBe(200);
    expect(published).toHaveLength(1);
    expect(published[0]?.conversationId).toBe(PSID);
    expect(history).toHaveLength(1);
  });

  test("POST chữ ký sai → 401, không ghi history", async () => {
    const { deps, history } = makeDeps();
    const raw = JSON.stringify(webhook(event({ message: { mid: "m1", text: "a" } })));
    const res = await createGateway(factory, deps).handle(
      new Request("http://x/webhook/meta", { method: "POST", body: raw, headers: signedHeaders(raw, "sai") }),
    );
    expect(res.status).toBe(401);
    expect(history).toHaveLength(0);
  });
});
