// ops-port.ts — impl OpsPort (port ở flash-command/types.ts) gọi hệ vận hành qua HTTP.
// 2 endpoint agent-session (service-to-service):
//   POST /agent-session/verify         — đổi token nhân viên gõ tay → user_id (anti-replay).
//   POST /agent-session/dealer-binding — tra đại lý gắn với zalo_group_id → dealer_id.
// Path KHÔNG có tiền tố `/api`: base URL (DILIM_API_URL) đã kèm sẵn.
// Auth = header x-service-token do client.ts tự gắn cho MỌI request (SERVICE_TOKEN_AGENT_API) —
// nơi này KHÔNG set lại. Response = unknown → validate shape ở boundary (không tin blind). Status
// "input sai" (token lạ/hết hạn, nhóm chưa gắn) → null, KHÔNG throw: đó là kết quả hợp lệ để
// command trả reply cho người dùng.

import type { OpsPort } from "../flash-command/types.ts";
import { OperationalError, opPost } from "./client.ts";

const VERIFY_PATH = "/agent-session/verify";
const DEALER_BINDING_PATH = "/agent-session/dealer-binding";

export class OperationalOpsPort implements OpsPort {
  /**
   * 200 → user_id. 404 (token không tồn tại/hết hạn) / 410 (token đã dùng) → null (input sai).
   * 401 = sai service key (config), 5xx, network → OperationalError bubble lên (lỗi thật).
   */
  async resolveUserByToken(
    token: string,
  ): Promise<{
    userId: string;
    roleSlug?: string;
    fullName?: string;
    role?: string;
  } | null> {
    let body: unknown;
    try {
      body = await opPost(VERIFY_PATH, { body: { token } });
    } catch (err) {
      if (
        err instanceof OperationalError &&
        (err.status === 404 || err.status === 410)
      )
        return null;
      throw err;
    }

    const userId = readUserId(body);
    if (userId === null) {
      throw new OperationalError(
        "verify: response thiếu user_id",
        200,
        "POST",
        VERIFY_PATH,
        "",
      );
    }
    // role_slug/full_name optional — thiếu thì bind vẫn chạy (chỉ user_id bắt buộc).
    return {
      userId,
      role: readOptionalString(body, "role"),
      roleSlug: readOptionalString(body, "role_slug"),
      fullName: readOptionalString(body, "full_name"),
    };
  }

  /**
   * 200 → data.dealer_id (= customerId). 404 (nhóm chưa gắn đại lý) → null.
   * 401 (token chưa verify/lạ), 5xx, network → OperationalError bubble lên (lỗi thật). `channel`
   * chưa dùng: endpoint hiện chỉ theo zalo_group_id — giữ ở port cho kênh khác sau này.
   */
  async fetchDealerInfo(p: {
    token: string;
    channel: string;
    groupId: string;
  }): Promise<{ customerId: string } | null> {
    let body: unknown;
    try {
      body = await opPost(DEALER_BINDING_PATH, {
        body: { token: p.token, zalo_group_id: p.groupId },
      });
    } catch (err) {
      if (err instanceof OperationalError && err.status === 404) return null;
      throw err;
    }
    const customerId = readDealerId(body);
    if (customerId === null) {
      throw new OperationalError(
        "dealer-binding: response thiếu data.dealer_id",
        200,
        "POST",
        DEALER_BINDING_PATH,
        "",
      );
    }
    return { customerId };
  }
}

/** verify OK: `{ user_id, role, full_name, role_slug }`. user_id bắt buộc; còn lại optional. */
function readUserId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const userId = (body as Record<string, unknown>)["user_id"];
  return typeof userId === "string" && userId !== "" ? userId : null;
}

/** Đọc field string tuỳ chọn từ response verify. Thiếu / rỗng / sai kiểu → undefined (không bịa). */
function readOptionalString(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * dealer-binding OK: `{ success: true, data: DealerBindingResult }`. customerId = data.dealer_id.
 * Hệ vận hành có thể trả dealer_id dạng số (id tự tăng) → chuẩn hoá về string vì customer_id là text.
 */
function readDealerId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as Record<string, unknown>)["data"];
  if (typeof data !== "object" || data === null) return null;
  const dealerId = (data as Record<string, unknown>)["dealer_id"];
  if (typeof dealerId === "number" && Number.isFinite(dealerId))
    return String(dealerId);
  return typeof dealerId === "string" && dealerId !== "" ? dealerId : null;
}
