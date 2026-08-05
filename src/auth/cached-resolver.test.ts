import { describe, expect, test } from "bun:test";
import { ActorRole, type Identity } from "../flash-command/types.ts";
import type { RedisCommand } from "../redis/types.ts";
import type { IdentityResolver, ResolveInput } from "./types.ts";
import { authCacheKey, CachedIdentityResolver } from "./cached-resolver.ts";

/** Redis giả có state: GET/SET/DEL trên map, ghi lại lệnh. Không server, không network. */
class FakeRedis {
  readonly store = new Map<string, string>();
  readonly calls: Array<{ name: string; args: string[] }> = [];
  readonly send: RedisCommand = (name, args) => {
    this.calls.push({ name, args });
    if (name === "GET") return Promise.resolve(this.store.get(args[0]!) ?? null);
    if (name === "SET") {
      this.store.set(args[0]!, args[1]!);
      return Promise.resolve("OK");
    }
    if (name === "DEL") {
      this.store.delete(args[0]!);
      return Promise.resolve(1);
    }
    return Promise.resolve(null);
  };
  argsOf(name: string): string[][] {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  }
}

/** Inner giả: trả identity đặt sẵn + đếm số lần bị gọi (để chứng minh HIT không chạm DB). */
class StubResolver implements IdentityResolver {
  calls = 0;
  constructor(private readonly identity: Identity) {}
  resolve(_input: ResolveInput): Promise<Identity> {
    this.calls++;
    return Promise.resolve(this.identity);
  }
}

const NHAN_VIEN: Identity = { role: ActorRole.NhanVien, senderId: "u1", userId: "op-1" };
const GUEST: Identity = { role: ActorRole.Guest, senderId: "u1" };
const IN: ResolveInput = { channel: "zalo", senderId: "u1", groupId: "g1" };

describe("CachedIdentityResolver", () => {
  test("MISS → gọi inner, SET cache TTL 8h, trả identity", async () => {
    const redis = new FakeRedis();
    const inner = new StubResolver(NHAN_VIEN);
    const r = new CachedIdentityResolver(inner, redis.send);

    expect(await r.resolve(IN)).toEqual(NHAN_VIEN);
    expect(inner.calls).toBe(1);
    const set = redis.argsOf("SET")[0]!;
    expect(set[0]).toBe(authCacheKey("zalo", "u1", "g1"));
    expect(JSON.parse(set[1]!)).toEqual(NHAN_VIEN);
    expect([set[2], set[3]]).toEqual(["EX", String(8 * 60 * 60)]);
  });

  test("HIT → parse cache, KHÔNG chạm inner", async () => {
    const redis = new FakeRedis();
    const inner = new StubResolver(NHAN_VIEN);
    const r = new CachedIdentityResolver(inner, redis.send);

    await r.resolve(IN); // seed cache
    inner.calls = 0;
    expect(await r.resolve(IN)).toEqual(NHAN_VIEN);
    expect(inner.calls).toBe(0);
  });

  test("guest → không cache (SET không được gọi)", async () => {
    const redis = new FakeRedis();
    const inner = new StubResolver(GUEST);
    const r = new CachedIdentityResolver(inner, redis.send);

    expect(await r.resolve(IN)).toEqual(GUEST);
    await r.resolve(IN);
    expect(redis.argsOf("SET")).toEqual([]);
    expect(inner.calls).toBe(2); // luôn hỏi inner vì không có cache
  });

  test("cache rác → coi như miss, hỏi inner", async () => {
    const redis = new FakeRedis();
    redis.store.set(authCacheKey("zalo", "u1", "g1"), "{not json");
    const inner = new StubResolver(NHAN_VIEN);
    const r = new CachedIdentityResolver(inner, redis.send);

    expect(await r.resolve(IN)).toEqual(NHAN_VIEN);
    expect(inner.calls).toBe(1);
  });

  test("key gồm groupId → cùng sender khác nhóm = key khác", () => {
    expect(authCacheKey("zalo", "u1", "g1")).not.toBe(authCacheKey("zalo", "u1", "g2"));
    expect(authCacheKey("zalo", "u1")).toBe("auth:zalo:u1:-");
  });
});
