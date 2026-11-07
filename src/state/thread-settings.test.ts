// Test SqlThreadSettings với executor giả: kiểm SQL + params + cách đọc row. KHÔNG chạy trên
// Postgres thật — upsert/PK cần thử một lần trên DB thật sau khi chạy migration 0015.

import { describe, expect, test } from "bun:test";
import { SqlThreadSettings } from "./thread-settings.ts";
import type { SqlExecutor } from "./types.ts";

function fakeExec(result: unknown) {
  const calls: Array<{ text: string; params: readonly unknown[] }> = [];
  const exec: SqlExecutor = {
    query(text, params) {
      calls.push({ text, params });
      return Promise.resolve(result);
    },
  };
  return { exec, calls };
}

describe("SqlThreadSettings", () => {
  test("không có row → bật (mặc định)", async () => {
    const { exec, calls } = fakeExec([]);
    expect(await new SqlThreadSettings(exec).isReplyEnabled("zalo-oa", "u1")).toBe(true);
    expect(calls[0]?.params).toEqual(["zalo-oa", "u1"]);
  });

  test("row reply_enabled=false → tắt", async () => {
    const { exec } = fakeExec([{ reply_enabled: false }]);
    expect(await new SqlThreadSettings(exec).isReplyEnabled("zalo-oa", "u1")).toBe(false);
  });

  test("row reply_enabled=true hoặc giá trị lạ → bật", async () => {
    expect(await new SqlThreadSettings(fakeExec([{ reply_enabled: true }]).exec).isReplyEnabled("c", "t")).toBe(true);
    expect(await new SqlThreadSettings(fakeExec([{ reply_enabled: "f" }]).exec).isReplyEnabled("c", "t")).toBe(true);
  });

  test("set → upsert đúng params, chỉ bind giá trị qua $n", async () => {
    const { exec, calls } = fakeExec([]);
    await new SqlThreadSettings(exec).setReplyEnabled("zalo-oa", "u1", false);
    expect(calls[0]?.params).toEqual(["zalo-oa", "u1", false]);
    expect(calls[0]?.text).toContain("ON CONFLICT (channel, thread_id)");
    expect(calls[0]?.text).not.toContain("u1");
  });
});
