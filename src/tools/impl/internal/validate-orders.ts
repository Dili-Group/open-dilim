// validate-orders.ts — tool GHI `duyet_don_qua_kho`: validate một lô đơn để đưa qua bước kho
// (`POST /agent/internal/orders/validate`). Đường GHI DUY NHẤT của cụm sổ nội bộ.
//
// Hàng rào theo VAI: chỉ nhân viên gọi được (role lấy từ identity server-side, không phải tham
// số LLM sinh). `x-staff-id` chỉ là audit tuỳ chọn — backend không đòi, nên bind hỏng không chặn.
//
// Đây là lệnh GHI → client KHÔNG retry. Lỗi transport/5xx nghĩa là KHÔNG BIẾT đã ghi hay chưa —
// phải nói đúng như vậy, đừng bảo người dùng "gửi lại đi" như thể chắc chắn chưa ghi.

import { ActorRole } from "../../../flash-command/types.ts";
import { AgentApiError } from "../../../operational/agent-api.ts";
import type { InternalValidateResult } from "../../../operational/types.ts";
import { readStringListField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { statusLabel } from "../order/scope.ts";

/** Trần backend cho một lô. Quá trần → chặn ngay ở tool, đừng để backend từ chối cả lô. */
const MAX_TRACKING_NUMBERS = 200;

const NO_PORT: ToolResult = {
  content:
    "Hệ thống sổ nội bộ chưa sẵn sàng — nói rõ là chưa duyệt được, kiểm tra lại sau.",
  isError: true,
};

/** Lệnh ghi toàn hệ thống — đại lý/guest không có cửa, dù backend không đòi header nhân viên. */
const NO_STAFF: ToolResult = {
  content:
    "Chỉ nhân viên mới duyệt đơn qua kho được. " +
    "Bảo người hỏi gõ /ketnoi-hethong <token> rồi gửi lại — KHÔNG duyệt hộ bằng đường khác.",
  isError: true,
};

const INVALID_LIST: ToolResult = {
  content:
    'Danh sách mã vận đơn không hợp lệ. Truyền "ma_van_don" là mảng 1–' +
    `${MAX_TRACKING_NUMBERS} chuỗi mã, mỗi mã một phần tử, không để phần tử rỗng.`,
  isError: true,
};

const TOO_MANY: ToolResult = {
  content:
    `Một lô tối đa ${MAX_TRACKING_NUMBERS} mã. Chia nhỏ danh sách rồi gọi lại từng lô — ` +
    "báo người gửi biết là đang chia lô.",
  isError: true,
};

/**
 * Lệnh ghi không retry nên lỗi hệ thống là trạng thái LỬNG: có thể đã ghi, có thể chưa.
 * Câu báo phải giữ đúng sự lửng đó — người thật soát sổ rồi mới quyết gửi lại.
 */
const WRITE_FAILED: ToolResult = {
  content:
    "Hệ thống vận hành đang không phản hồi nên KHÔNG RÕ lô này đã được ghi hay chưa. " +
    "Nói rõ như vậy và bảo người gửi đợi kiểm tra lại — ĐỪNG tự gửi lại lô, có thể ghi trùng.",
  isError: true,
};

export function buildValidateOrdersTool(ctx: ToolContext): Tool {
  return {
    name: "duyet_don_qua_kho",
    description:
      "Validate (duyệt) một lô đơn hàng để đưa qua bước kho. Nhận danh sách mã vận đơn " +
      `(1–${MAX_TRACKING_NUMBERS} mã), trả về từng mã đã duyệt / duyệt từ trước / bị từ chối / ` +
      "không tìm thấy / bị loại. Đây là lệnh GHI — chỉ gọi khi người gửi nói rõ muốn duyệt, " +
      "không tự gom mã từ chỗ khác. Chỉ nhân viên gọi được.",
    inputSchema: {
      type: "object",
      properties: {
        ma_van_don: {
          type: "array",
          items: { type: "string" },
          description:
            `Danh sách mã vận đơn cần duyệt qua kho, 1–${MAX_TRACKING_NUMBERS} mã, ` +
            "đúng nguyên văn người gửi đưa.",
        },
      },
      required: ["ma_van_don"],
    },
    announce: "Em duyệt lô đơn qua kho chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> =>
      run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const internal = ctx.internal;
  if (internal === undefined) return NO_PORT;

  if (ctx.identity.role !== ActorRole.NhanVien) return NO_STAFF;
  const staffId = resolveStaffId(ctx);

  const trackingNumbers = readStringListField(input, "ma_van_don");
  if (trackingNumbers === undefined || trackingNumbers.length === 0)
    return INVALID_LIST;
  if (trackingNumbers.length > MAX_TRACKING_NUMBERS) return TOO_MANY;

  try {
    return {
      content: render(
        await internal.validateOrders({ staffId, trackingNumbers, signal }),
      ),
    };
  } catch (err) {
    if (err instanceof AgentApiError) {
      // message chỉ có method/path/status/code — KHÔNG có service token.
      console.error("[duyet_don_qua_kho] API vận hành lỗi:", err.message);
      return WRITE_FAILED;
    }
    throw err;
  }
}

/**
 * Audit người ghi — TUỲ CHỌN, backend không đòi. `accounts.id` bigint nên chỉ nhận chuỗi số
 * thuần; bind cũ/hỏng (uuid) → undefined: lệnh vẫn chạy, chỉ mất dòng audit, KHÔNG chặn việc.
 */
function resolveStaffId(ctx: ToolContext): string | undefined {
  if (ctx.identity.role !== ActorRole.NhanVien) return undefined;
  return /^\d+$/.test(ctx.identity.userId) ? ctx.identity.userId : undefined;
}

/** Thiếu số đếm là dữ kiện phải nói ra, KHÔNG được im lặng biến thành 0. */
const COUNT_MISSING = "hệ thống không trả số";

export function render(result: InternalValidateResult): string {
  const lines: string[] = [
    "Kết quả duyệt đơn qua kho:",
    `Duyệt mới: ${countOf(result.validated)}`,
  ];
  if (result.alreadyValidated !== undefined && result.alreadyValidated > 0) {
    lines.push(`Đã duyệt từ trước (bỏ qua): ${result.alreadyValidated} đơn`);
  }
  if (result.rejected.length > 0) {
    lines.push("Bị TỪ CHỐI (trạng thái đơn không cho qua kho):");
    lines.push(
      ...result.rejected.map(
        (line) => `- ${line.trackingNumber} · ${statusLabel(line.status)}`,
      ),
    );
  }
  if (result.notFound.length > 0) {
    lines.push("KHÔNG TÌM THẤY trên hệ thống:");
    lines.push(...result.notFound.map((code) => `- ${code}`));
  }
  if (result.excluded.length > 0) {
    lines.push("Bị LOẠI khỏi lô (luật nghiệp vụ):");
    lines.push(
      ...result.excluded.map(
        (line) =>
          `- ${line.trackingNumber} · ${line.reason ?? "không rõ lý do"}`,
      ),
    );
  }
  lines.push(
    "Báo lại đầy đủ: số duyệt được VÀ từng mã không qua kèm lý do — đừng chỉ báo phần thành công.",
  );
  return lines.join("\n");
}

function countOf(count: number | undefined): string {
  return count === undefined ? COUNT_MISSING : `${count} đơn`;
}
