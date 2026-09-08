// Test egress OA: nguồn access_token (cache + gộp call + shape response) và ZaloOaBroadcaster
// (body Open API v3, lỗi nghiệp vụ trong HTTP 200, retry một lần khi token bị từ chối).
// fetch bị thay bằng stub — không chạm network.

import { afterEach, describe, expect, test } from "bun:test";
import type { BroadcastTarget } from "./types.ts";
import { ZaloOaBroadcaster } from "./zalo-oa.ts";
import { ZaloOaTokenSource, type ZaloOaTokenPort } from "./zalo-oa-token.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Call = { url: string; init?: RequestInit };

/** Stub fetch trả lần lượt từng response; hết thì lặp lại cái cuối. */
function stubFetch(responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const make = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (make === undefined) throw new Error("stub thiếu response");
    return Promise.resolve(make());
  }) as unknown as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): () => Response {
  return () => new Response(JSON.stringify(body), { status });
}

function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new Error(`body không phải string: ${typeof body}`);
  return JSON.parse(body);
}

const TARGET: BroadcastTarget = {
  channel: "zalo-oa",
  conversationId: "2268360619345212892",
  isGroup: false,
  replyToSenderId: "2268360619345212892",
  replyToSenderName: "Khách",
};

describe("ZaloOaTokenSource", () => {
  const config = { url: "https://api.dilisupplement.com/api/agent/zalo-oa/token", serviceToken: "svc" };

  test("lấy token, gửi service token, cache lần sau không gọi lại", async () => {
    const calls = stubFetch([json({ access_token: "tok-1", expires_in: "3600" })]);
    const source = new ZaloOaTokenSource(config);

    expect(await source.get()).toBe("tok-1");
    expect(await source.get()).toBe("tok-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(config.url);
    expect((calls[0]?.init?.headers as Record<string, string>)["x-service-token"]).toBe("svc");
  });

  test("force → bỏ cache, gọi lại", async () => {
    const calls = stubFetch([
      json({ access_token: "tok-1", expires_in: "3600" }),
      json({ access_token: "tok-2", expires_in: "3600" }),
    ]);
    const source = new ZaloOaTokenSource(config);

    expect(await source.get()).toBe("tok-1");
    expect(await source.get(true)).toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  test("nhiều lần hỏi cùng nhịp → gộp thành MỘT call", async () => {
    const calls = stubFetch([json({ access_token: "tok-1", expires_in: "3600" })]);
    const source = new ZaloOaTokenSource(config);

    const all = await Promise.all([source.get(), source.get(), source.get()]);
    expect(all).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(calls).toHaveLength(1);
  });

  test("token bọc trong `data` cũng đọc được", async () => {
    stubFetch([json({ data: { access_token: "tok-boc" } })]);
    expect(await new ZaloOaTokenSource(config).get()).toBe("tok-boc");
  });

  test("shape lạ → throw, KHÔNG in body ra message", async () => {
    stubFetch([json({ token: "sai-ten-field" })]);
    const err = await new ZaloOaTokenSource(config).get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("sai-ten-field");
  });

  test("backend trả 500 → throw kèm status", async () => {
    stubFetch([json({ error: "boom" }, 500)]);
    const err = await new ZaloOaTokenSource(config).get().catch((e: unknown) => e);
    expect((err as Error).message).toContain("500");
  });
});

/** Token giả: đếm số lần bị hỏi và có bị ép làm mới không. */
class FakeToken implements ZaloOaTokenPort {
  readonly asked: boolean[] = [];
  #n = 0;
  get(force = false): Promise<string> {
    this.asked.push(force);
    this.#n += 1;
    return Promise.resolve(`tok-${this.#n}`);
  }
}

describe("ZaloOaBroadcaster", () => {
  test("send → POST message/cs với recipient.user_id + access_token header", async () => {
    const calls = stubFetch([json({ error: 0, message: "Success" })]);
    await new ZaloOaBroadcaster(new FakeToken()).send(TARGET, "chào bạn");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://openapi.zalo.me/v3.0/oa/message/cs");
    expect((calls[0]?.init?.headers as Record<string, string>)["access_token"]).toBe("tok-1");
    expect(jsonBody(calls[0]?.init)).toEqual({
      recipient: { user_id: TARGET.conversationId },
      message: { text: "chào bạn" },
    });
  });

  test("chat 1-1 → KHÔNG prefix @tên", async () => {
    const calls = stubFetch([json({ error: 0 })]);
    await new ZaloOaBroadcaster(new FakeToken()).send(TARGET, "xong rồi nhé");

    const body = jsonBody(calls[0]?.init) as { message: { text: string } };
    expect(body.message.text).toBe("xong rồi nhé");
  });

  test("HTTP 200 nhưng error != 0 → THROW (không coi là gửi thành công)", async () => {
    stubFetch([json({ error: -32, message: "User is not follower" })]);
    const send = new ZaloOaBroadcaster(new FakeToken()).send(TARGET, "hi");

    await expect(send).rejects.toThrow("error=-32");
  });

  test("error -216 (token chết) → lấy token mới và gửi lại đúng một lần", async () => {
    let n = 0;
    const calls = stubFetch([
      () => {
        n += 1;
        return new Response(JSON.stringify(n === 1 ? { error: -216 } : { error: 0 }), {
          status: 200,
        });
      },
    ]);
    const token = new FakeToken();
    await new ZaloOaBroadcaster(token).send(TARGET, "hi");

    expect(calls).toHaveLength(2);
    expect(token.asked).toEqual([false, true]);
    expect((calls[1]?.init?.headers as Record<string, string>)["access_token"]).toBe("tok-2");
  });

  test("mã lỗi khác → KHÔNG retry", async () => {
    const calls = stubFetch([json({ error: -32, message: "nope" })]);
    await new ZaloOaBroadcaster(new FakeToken()).send(TARGET, "hi").catch(() => undefined);

    expect(calls).toHaveLength(1);
  });

  test("isGroup → throw (OA không có nhóm)", async () => {
    stubFetch([json({ error: 0 })]);
    const send = new ZaloOaBroadcaster(new FakeToken()).send({ ...TARGET, isGroup: true }, "hi");

    await expect(send).rejects.toThrow("không có nhóm");
  });

  test("sendMedia → template media; Zalo từ chối thì hạ xuống gửi link text", async () => {
    let n = 0;
    const calls = stubFetch([
      () => {
        n += 1;
        return new Response(JSON.stringify(n === 1 ? { error: -100 } : { error: 0 }), {
          status: 200,
        });
      },
    ]);
    await new ZaloOaBroadcaster(new FakeToken()).sendMedia(TARGET, {
      type: "image",
      url: "https://cdn.dili/qr.png",
      caption: "Quét mã chuyển 500k",
    });

    const first = jsonBody(calls[0]?.init) as { message: { attachment?: unknown } };
    expect(first.message.attachment).toBeDefined();
    const fallback = jsonBody(calls[1]?.init) as { message: { text: string } };
    expect(fallback.message.text).toBe("Quét mã chuyển 500k\nhttps://cdn.dili/qr.png");
  });

  test("sendMedia thành công + có caption → gửi thêm tin chữ", async () => {
    const calls = stubFetch([json({ error: 0 })]);
    await new ZaloOaBroadcaster(new FakeToken()).sendMedia(TARGET, {
      type: "image",
      url: "https://cdn.dili/qr.png",
      caption: "Quét mã",
    });

    expect(calls).toHaveLength(2);
    const second = jsonBody(calls[1]?.init) as { message: { text: string } };
    expect(second.message.text).toBe("Quét mã");
  });
});
