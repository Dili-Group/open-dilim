// Test egress: router chọn đúng adapter theo channel, ZaloBroadcaster dựng đúng request /send
// và KHÔNG nuốt lỗi bridge. fetch bị thay bằng stub — không chạm network.

import { afterEach, describe, expect, test } from "bun:test";
import { BroadcastRouter } from "./router.ts";
import { ZaloBroadcaster } from "./zalo.ts";
import type { Broadcaster, BroadcastTarget, OutboundMedia } from "./types.ts";

const target: BroadcastTarget = {
  channel: "zalo",
  conversationId: "group_777",
  isGroup: true,
  replyToSenderId: "user_555",
};

class RecordingBroadcaster implements Broadcaster {
  readonly sent: string[] = [];
  readonly media: OutboundMedia[] = [];
  send(_target: BroadcastTarget, text: string): Promise<void> {
    this.sent.push(text);
    return Promise.resolve();
  }
  sendMedia(_target: BroadcastTarget, media: OutboundMedia): Promise<void> {
    this.media.push(media);
    return Promise.resolve();
  }
}

describe("BroadcastRouter", () => {
  test("channel đã đăng ký → dùng adapter của channel đó", async () => {
    const zalo = new RecordingBroadcaster();
    const fallback = new RecordingBroadcaster();
    const router = new BroadcastRouter(fallback).register("zalo", zalo);

    await router.send(target, "xong rồi");

    expect(zalo.sent).toEqual(["xong rồi"]);
    expect(fallback.sent).toEqual([]);
  });

  test("channel chưa đăng ký → fallback", async () => {
    const fallback = new RecordingBroadcaster();
    const router = new BroadcastRouter(fallback);

    await router.send({ ...target, channel: "messenger" }, "hi");

    expect(fallback.sent).toEqual(["hi"]);
  });

  test("sendMedia cũng route theo channel", async () => {
    const zalo = new RecordingBroadcaster();
    const fallback = new RecordingBroadcaster();
    const router = new BroadcastRouter(fallback).register("zalo", zalo);

    await router.sendMedia(target, { type: "image", url: "https://cdn/x.jpg" });

    expect(zalo.media).toEqual([{ type: "image", url: "https://cdn/x.jpg" }]);
    expect(fallback.media).toEqual([]);
  });
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Thay fetch bằng stub trả `response`, giữ lại request để assert. */
function stubFetch(response: Response): { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
  return { calls };
}

/** Body của request stub luôn là JSON string (adapter tự stringify) — narrow rồi parse. */
function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new Error(`body không phải string: ${typeof body}`);
  return JSON.parse(body);
}

describe("ZaloBroadcaster", () => {
  const config = { baseUrl: "http://localhost:2604/", secret: "s3cret" };

  test("POST /send với threadId/threadType/message + header auth", async () => {
    const stub = stubFetch(Response.json({ ok: true, msgId: "msg_ghi789" }));

    await new ZaloBroadcaster(config).send(target, "Đơn 123 đã giao thành công.");

    const call = stub.calls[0];
    expect(call?.url).toBe("http://localhost:2604/send");
    const headers = call?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["x-dilim-zalo-bridge"]).toBe("s3cret");
    expect(jsonBody(call?.init)).toEqual({
      threadId: "group_777",
      threadType: "group",
      message: "Đơn 123 đã giao thành công.",
    });
  });

  test("chat 1-1 → threadType user", async () => {
    const stub = stubFetch(Response.json({ ok: true, msgId: "m1" }));

    await new ZaloBroadcaster(config).send({ ...target, isGroup: false }, "hi");

    expect(jsonBody(stub.calls[0]?.init)).toMatchObject({ threadType: "user" });
  });

  test("bridge lỗi → throw (không nuốt như typing)", async () => {
    stubFetch(Response.json({ ok: false, error: "zalo từ chối" }, { status: 500 }));

    await expect(new ZaloBroadcaster(config).send(target, "hi")).rejects.toThrow("500");
  });

  test("sendMedia image → POST /send-image với imageUrl + caption", async () => {
    const stub = stubFetch(Response.json({ ok: true, msgId: "m2" }));

    await new ZaloBroadcaster(config).sendMedia(target, {
      type: "image",
      url: "https://cdn/hoa-don.jpg",
      caption: "Hóa đơn đơn 123",
    });

    const call = stub.calls[0];
    expect(call?.url).toBe("http://localhost:2604/send-image");
    const headers = call?.init?.headers as Record<string, string> | undefined;
    expect(headers?.["x-dilim-zalo-bridge"]).toBe("s3cret");
    expect(jsonBody(call?.init)).toEqual({
      threadId: "group_777",
      threadType: "group",
      imageUrl: "https://cdn/hoa-don.jpg",
      caption: "Hóa đơn đơn 123",
    });
  });

  test("sendMedia file, không caption → cũng POST /send-image (bridge không có /send-file), body không có key caption", async () => {
    const stub = stubFetch(Response.json({ ok: true, msgId: "m3" }));

    await new ZaloBroadcaster(config).sendMedia(
      { ...target, isGroup: false },
      { type: "file", url: "https://cdn/bao-cao.xlsx" },
    );

    const call = stub.calls[0];
    expect(call?.url).toBe("http://localhost:2604/send-image");
    expect(jsonBody(call?.init)).toEqual({
      threadId: "group_777",
      threadType: "user",
      imageUrl: "https://cdn/bao-cao.xlsx",
    });
  });

  test("sendMedia bridge lỗi → throw", async () => {
    stubFetch(Response.json({ ok: false, error: "zalo từ chối" }, { status: 500 }));

    await expect(
      new ZaloBroadcaster(config).sendMedia(target, { type: "image", url: "https://cdn/x.jpg" }),
    ).rejects.toThrow("500");
  });
});
