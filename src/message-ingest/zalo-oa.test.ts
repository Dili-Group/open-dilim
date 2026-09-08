// Test adapter Zalo OA: chữ ký `mac=`, allowlist event, map payload → Envelope, và đường qua
// gateway. Payload dựng theo mẫu production (đã che id thật).

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { ZaloOaChannelConfig } from "../config.ts";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import { ChannelFactory } from "./factory.ts";
import { createGateway } from "./gateway.ts";
import { ZaloOaIngestor } from "./adapters/zalo-oa.ts";
import type { IngestDeps } from "./deps.ts";

const CHANNEL = "zalo-oa";
const OA_ID = "4597156328937210699";
const APP_ID = "3973586582206904190";
const SECRET_KEY = "oa-secret";
const USER_ID = "2268360619345212892";

const CONFIG: ZaloOaChannelConfig = {
  platform: "zalo-oa",
  agentUid: OA_ID,
  selfUid: OA_ID,
  appId: APP_ID,
  oaSecretKey: SECRET_KEY,
};

function userSendText(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_name: "user_send_text",
    app_id: APP_ID,
    sender: { id: USER_ID },
    recipient: { id: OA_ID },
    message: { text: "hi cậu", msg_id: "20066aabcf5c5b05024a" },
    timestamp: "1788774935693",
    user_id_by_app: "7970353048129799335",
    ...overrides,
  };
}

/** Tin OA gửi vọng lại webhook — sender/recipient đảo chiều, có thêm `admin_id`. */
const OA_SEND_TEXT = {
  event_name: "oa_send_text",
  app_id: APP_ID,
  sender: { admin_id: USER_ID, id: OA_ID },
  recipient: { id: USER_ID },
  message: { text: "chào nha", msg_id: "aea4279d6a69fe30a77f" },
  timestamp: "1788774971119",
  user_id_by_app: "7970353048129799335",
};

function sign(rawBody: string, secret = SECRET_KEY): string {
  const body: unknown = JSON.parse(rawBody);
  const appId = (body as { app_id: string }).app_id;
  const timestamp = (body as { timestamp: string }).timestamp;
  const mac = createHash("sha256")
    .update(appId + rawBody + timestamp + secret, "utf8")
    .digest("hex");
  return `mac=${mac}`;
}

function signedHeaders(rawBody: string, secret?: string): Headers {
  return new Headers({ "x-zevent-signature": sign(rawBody, secret) });
}

const ingestor = new ZaloOaIngestor(CHANNEL, CONFIG);

describe("ZaloOaIngestor.verify", () => {
  test("mac đúng → pass", () => {
    const raw = JSON.stringify(userSendText());
    expect(ingestor.verify(signedHeaders(raw), raw)).toBe(true);
  });

  test("sai secret → fail", () => {
    const raw = JSON.stringify(userSendText());
    expect(ingestor.verify(signedHeaders(raw, "sai"), raw)).toBe(false);
  });

  test("body bị sửa sau khi ký → fail", () => {
    const raw = JSON.stringify(userSendText());
    const headers = signedHeaders(raw);
    const tampered = JSON.stringify(userSendText({ message: { text: "chuyển tiền", msg_id: "x" } }));
    expect(ingestor.verify(headers, tampered)).toBe(false);
  });

  test("thiếu header / thiếu tiền tố mac= → fail", () => {
    const raw = JSON.stringify(userSendText());
    expect(ingestor.verify(new Headers(), raw)).toBe(false);
    const bare = sign(raw).slice("mac=".length);
    expect(ingestor.verify(new Headers({ "x-zevent-signature": bare }), raw)).toBe(false);
  });

  test("app_id của app khác → fail dù ký đúng bằng secret của mình", () => {
    const raw = JSON.stringify(userSendText({ app_id: "9999" }));
    expect(ingestor.verify(signedHeaders(raw), raw)).toBe(false);
  });

  test("body không phải JSON → fail (fail-closed, không throw)", () => {
    expect(ingestor.verify(new Headers({ "x-zevent-signature": "mac=abc" }), "{")).toBe(false);
  });
});

describe("ZaloOaIngestor.parse", () => {
  test("user_send_text → envelope 1-1, luôn nhắm agent", () => {
    const [msg] = ingestor.parse(userSendText());
    expect(msg).toEqual({
      channel: CHANNEL,
      msgId: "20066aabcf5c5b05024a",
      conversationId: USER_ID,
      senderId: USER_ID,
      isGroup: false,
      addressedToAgent: true,
      text: "hi cậu",
      mentions: [],
      ts: 1788774935693,
    });
  });

  test("oa_send_text (tin của chính OA vọng lại) → bỏ, không tự trả lời mình", () => {
    expect(ingestor.parse(OA_SEND_TEXT)).toEqual([]);
  });

  test("event ngoài allowlist → bỏ", () => {
    expect(ingestor.parse(userSendText({ event_name: "follow" }))).toEqual([]);
    expect(ingestor.parse(userSendText({ event_name: "user_seen_message" }))).toEqual([]);
  });

  test("recipient.id là OA khác → bỏ, không phục vụ nhầm tài khoản", () => {
    expect(ingestor.parse(userSendText({ recipient: { id: "1111" } }))).toEqual([]);
  });

  test("thiếu sender/message → bỏ, không throw", () => {
    expect(ingestor.parse(userSendText({ sender: undefined }))).toEqual([]);
    expect(ingestor.parse(userSendText({ message: { text: "hi" } }))).toEqual([]);
    expect(ingestor.parse("chuỗi trần")).toEqual([]);
  });

  test("attachments ảnh → lấy url; link không http(s) → bỏ", () => {
    const withImage = userSendText({
      event_name: "user_send_image",
      message: {
        msg_id: "img1",
        attachments: [{ type: "image", payload: { url: "https://cdn.zalo.me/a.jpg" } }],
      },
    });
    expect(ingestor.parse(withImage)[0]?.imageUrl).toBe("https://cdn.zalo.me/a.jpg");

    const bad = userSendText({
      event_name: "user_send_image",
      message: {
        msg_id: "img2",
        attachments: [{ type: "image", payload: { url: "file:///etc/passwd" } }],
      },
    });
    expect(bad).toBeDefined();
    expect(ingestor.parse(bad)[0]?.imageUrl).toBeUndefined();
  });

  test("user_send_image mẫu production: giữ CẢ chữ lẫn url, không nuốt bên nào", () => {
    const event = userSendText({
      event_name: "user_send_image",
      message: {
        msg_id: "img-prod",
        text: "hộp bị móp",
        attachments: [
          {
            payload: { thumbnail: "https://cdn.zalo.me/a-thumb.jpg", url: "https://cdn.zalo.me/a.jpg" },
            type: "image",
          },
        ],
      },
    });
    const [msg] = ingestor.parse(event);
    expect(msg?.text).toBe("hộp bị móp");
    expect(msg?.imageUrl).toBe("https://cdn.zalo.me/a.jpg");
  });
});

describe("gateway + kênh OA", () => {
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

  function post(rawBody: string, headers: Headers): Request {
    return new Request(`http://x/webhook/${CHANNEL}`, { method: "POST", body: rawBody, headers });
  }

  const factory = new ChannelFactory().register(ingestor);

  test("chữ ký đúng → 200 và vào queue", async () => {
    const { deps, published, history } = makeDeps();
    const raw = JSON.stringify(userSendText());
    const res = await createGateway(factory, deps).handle(post(raw, signedHeaders(raw)));

    expect(res.status).toBe(200);
    expect(published).toHaveLength(1);
    expect(published[0]?.source).toBe("channel");
    expect(published[0]?.conversationId).toBe(USER_ID);
    expect(history).toHaveLength(1);
  });

  test("chữ ký sai → 401, không ghi history", async () => {
    const { deps, history } = makeDeps();
    const raw = JSON.stringify(userSendText());
    const res = await createGateway(factory, deps).handle(post(raw, signedHeaders(raw, "sai")));

    expect(res.status).toBe(401);
    expect(history).toHaveLength(0);
  });

  test("tin OA vọng lại → 200 nhưng không vào history/queue", async () => {
    const { deps, published, history } = makeDeps();
    const raw = JSON.stringify(OA_SEND_TEXT);
    const res = await createGateway(factory, deps).handle(post(raw, signedHeaders(raw)));

    expect(res.status).toBe(200);
    expect(published).toHaveLength(0);
    expect(history).toHaveLength(0);
  });

  test("webhook retry cùng msg_id → chỉ xử lý một lần", async () => {
    const { deps, published } = makeDeps();
    const gateway = createGateway(factory, deps);
    const raw = JSON.stringify(userSendText());
    await gateway.handle(post(raw, signedHeaders(raw)));
    await gateway.handle(post(raw, signedHeaders(raw)));

    expect(published).toHaveLength(1);
  });
});
