// Test in-mem deps của bootstrap (Broker/History/Dedupe). Không I/O thật — thuần RAM.
// bootstrap()/start() cần Postgres sống nên không test ở đây (integration, chạy riêng).

import { describe, expect, test } from "bun:test";
import type { Envelope, HistoryEntry } from "../types/index.ts";
import {
  MemoryBroker,
  MemoryDedupe,
  MemoryHistoryStore,
  createMemoryDeps,
} from "./deps-memory.ts";

const envelope: Envelope = {
  source: "channel",
  channel: "zalo",
  msgId: "m1",
  conversationId: "c1",
  senderId: "u1",
  isGroup: false,
  addressedToAgent: true,
  text: "hi",
  mentions: [],
  ts: 1,
};

const historyEntry: HistoryEntry = {
  conversationId: "c1",
  msgId: "m1",
  senderId: "u1",
  text: "hi",
  isGroup: false,
  ts: 1,
};

describe("MemoryBroker", () => {
  test("publish enqueue theo thứ tự", async () => {
    const broker = new MemoryBroker();
    await broker.publish(envelope);
    await broker.publish({ ...envelope, msgId: "m2" });
    expect(broker.queue.map((d) => d.envelope.msgId)).toEqual(["m1", "m2"]);
  });
});

describe("MemoryHistoryStore", () => {
  test("append giữ thứ tự", async () => {
    const store = new MemoryHistoryStore();
    await store.append(historyEntry);
    await store.append({ ...historyEntry, msgId: "m2" });
    expect(store.entries.map((e) => e.msgId)).toEqual(["m1", "m2"]);
  });
});

describe("MemoryDedupe", () => {
  test("firstSee: lần đầu true, trùng false", async () => {
    const dedupe = new MemoryDedupe();
    expect(await dedupe.firstSee("zalo", "m1")).toBe(true);
    expect(await dedupe.firstSee("zalo", "m1")).toBe(false);
  });

  test("release: gỡ mark → firstSee lại true", async () => {
    const dedupe = new MemoryDedupe();
    await dedupe.firstSee("zalo", "m1");
    await dedupe.release("zalo", "m1");
    expect(await dedupe.firstSee("zalo", "m1")).toBe(true);
  });

  test("key tách theo channel: cùng msgId khác channel không đụng nhau", async () => {
    const dedupe = new MemoryDedupe();
    expect(await dedupe.firstSee("zalo", "m1")).toBe(true);
    expect(await dedupe.firstSee("telegram", "m1")).toBe(true);
  });
});

describe("createMemoryDeps", () => {
  test("trả đủ 3 port dùng được", async () => {
    const deps = createMemoryDeps();
    expect(await deps.dedupe.firstSee("zalo", "m1")).toBe(true);
    await deps.history.append(historyEntry);
    await deps.broker.publish(envelope);
  });
});
