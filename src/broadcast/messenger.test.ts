// Test egress Messenger: shape Send API v26.0, auth header, lỗi Meta không bị nuốt, typing
// best-effort. fetch bị thay bằng stub — không chạm network.

import { afterEach, describe, expect, test } from "bun:test";
import { MessengerBroadcaster } from "./messenger.ts";
import { MessengerTypingSender } from "./messenger-typing.ts";
import type { BroadcastTarget } from "./types.ts";

const TOKEN = "page-token";
const TARGET: BroadcastTarget = {
  channel: "meta",
  conversationId: "PSID1",
  isGroup: false,
  replyToSenderId: "PSID1",
};

interface Call {
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Stub trả lần lượt các response; response hết thì dùng lại cái cuối. */
function stubFetch(...responses: Response[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const body = init?.body;
    calls.push({
      url,
      headers: new Headers(init?.headers),
      body: typeof body === "string" ? JSON.parse(body) : undefined,
    });
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Promise.resolve(response ?? new Response(null, { status: 500 }));
  }) as unknown as typeof fetch;
  return calls;
}

const ok = () => new Response(JSON.stringify({ recipient_id: "PSID1", message_id: "m" }));
const rejected = () =>
  new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), {
    status: 400,
  });

describe("MessengerBroadcaster", () => {
  test("send → POST v26.0/me/messages, RESPONSE, token ở header", async () => {
    const calls = stubFetch(ok());
    await new MessengerBroadcaster(TOKEN).send(TARGET, "dạ em chào anh");

    expect(calls[0]?.url).toBe("https://graph.facebook.com/v26.0/me/messages");
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.body).toEqual({
      recipient: { id: "PSID1" },
      messaging_type: "RESPONSE",
      message: { text: "dạ em chào anh" },
    });
  });

  test("Meta từ chối → throw (không nuốt lỗi)", async () => {
    stubFetch(rejected());
    await expect(new MessengerBroadcaster(TOKEN).send(TARGET, "a")).rejects.toThrow("HTTP 400");
  });

  test("target nhóm → throw, không gọi Meta", async () => {
    const calls = stubFetch(ok());
    await expect(new MessengerBroadcaster(TOKEN).send({ ...TARGET, isGroup: true }, "a")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("sendMedia → attachment theo URL, rồi caption", async () => {
    const calls = stubFetch(ok());
    await new MessengerBroadcaster(TOKEN).sendMedia(TARGET, {
      type: "image",
      url: "https://cdn/qr.png",
      caption: "QR chuyển khoản",
    });

    expect(calls.map((c) => c.body)).toEqual([
      {
        recipient: { id: "PSID1" },
        messaging_type: "RESPONSE",
        message: { attachment: { type: "image", payload: { url: "https://cdn/qr.png", is_reusable: false } } },
      },
      { recipient: { id: "PSID1" }, messaging_type: "RESPONSE", message: { text: "QR chuyển khoản" } },
    ]);
  });

  test("sendMedia bị từ chối → hạ xuống link text", async () => {
    const calls = stubFetch(rejected(), ok());
    await new MessengerBroadcaster(TOKEN).sendMedia(TARGET, { type: "image", url: "https://cdn/qr.png" });

    expect(calls[1]?.body).toEqual({
      recipient: { id: "PSID1" },
      messaging_type: "RESPONSE",
      message: { text: "https://cdn/qr.png" },
    });
  });
});

describe("MessengerTypingSender", () => {
  test("gửi typing_on", async () => {
    const calls = stubFetch(ok());
    await new MessengerTypingSender(TOKEN).typing(TARGET);
    expect(calls[0]?.body).toEqual({ recipient: { id: "PSID1" }, sender_action: "typing_on" });
  });

  test("Meta lỗi → không throw", async () => {
    stubFetch(rejected());
    await expect(new MessengerTypingSender(TOKEN).typing(TARGET)).resolves.toBeUndefined();
  });
});
