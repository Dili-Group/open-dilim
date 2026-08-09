// drafts.ts — bản nháp thông báo nằm ở Redis giữa hai lượt agent.
//
// Ở Redis chứ không ở bộ nhớ process: lượt soạn và lượt gửi là HAI request khác nhau, có thể rơi
// vào hai worker khác nhau (và hai instance khác nhau). Giữ trong RAM là lượt gửi không thấy nháp.

import type { RedisCommand } from "../redis/types.ts";
import type { AnnouncementDraft, DraftStore } from "./types.ts";

const KEY_PREFIX = "dilim:announce:draft:";

function draftKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export class RedisDraftStore implements DraftStore {
  constructor(private readonly send: RedisCommand) {}

  async put(draft: AnnouncementDraft, ttlSec: number): Promise<void> {
    await this.send("SET", [
      draftKey(draft.id),
      JSON.stringify({ text: draft.text, authorSenderId: draft.authorSenderId }),
      "EX",
      String(ttlSec),
    ]);
  }

  /**
   * GETDEL = đọc và xoá ATOMIC (Redis 6.2+). Tách thành GET rồi DEL thì hai lượt gửi chạy song
   * song cùng đọc được một nháp → mọi đại lý nhận tin hai lần. Đây là chốt chống gửi trùng duy
   * nhất của luồng này, không có lock nào khác đỡ.
   */
  async take(id: string): Promise<AnnouncementDraft | undefined> {
    const raw = await this.send("GETDEL", [draftKey(id)]);
    if (typeof raw !== "string") return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Giá trị rác trong key của chính mình = không tin được → coi như không có nháp. Nháp đã bị
      // GETDEL xoá rồi nên người dùng sẽ được yêu cầu soạn lại, không kẹt.
      console.error(`[announcements] nháp ${id} không parse được JSON — bỏ.`);
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;

    const rec = parsed as Record<string, unknown>;
    const text = rec["text"];
    const authorSenderId = rec["authorSenderId"];
    if (typeof text !== "string" || typeof authorSenderId !== "string") return undefined;
    return { id, text, authorSenderId };
  }
}
