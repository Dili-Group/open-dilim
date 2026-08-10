// poscake.ts — `nap_poscake` GHI: nạp Shop ID + API Key PosCake của đại lý phòng này vào hệ vận
// hành, để đơn tạo trên PosCake tự chảy về DILIM.
//
// Đây là tool DUY NHẤT nhận một BÍ MẬT của đại lý làm tham số. Luật riêng, ngoài hàng rào thường:
//
//   - Key đi MỘT CHIỀU: đọc từ input → gửi backend → quên. KHÔNG in lại trong kết quả, KHÔNG log,
//     kể cả khi lỗi (message lỗi chỉ mang status + code + path, không mang body đã gửi).
//   - Chỉ ĐẠI LÝ hoặc NHÂN VIÊN gõ mới chạy được. Guest = người chưa định danh trong phòng → nạp
//     credential dưới tên đại lý chủ phòng là không có ai chịu trách nhiệm.
//   - Đại lý đi lên header `x-dealer-id` từ CHỦ PHÒNG, nhân viên lên `x-staff-id` — model không có
//     tham số nào chỉ định người, chỉ chép được shop id và key đại lý vừa đưa.
//
// Webhook URL KHÔNG nằm ở đây: vận hành cấp riêng từng đại lý, agent không ghép, không đoán
// (reference `huong-dan/poscake.md`).

import { ActorRole } from "../../../flash-command/types.ts";
import { AgentApiError } from "../../../operational/agent-api.ts";
import type { PoscakeShopLink } from "../../../operational/types.ts";
import { readStringField } from "../../input.ts";
import type { Tool, ToolContext, ToolResult } from "../../types.ts";
import { NO_CUSTOMER, line, resolvePrincipal } from "../order/scope.ts";

/** Shop ID PosCake = dãy số trong URL `/shop/<id>/`. Chuỗi số thuần, không dấu cách, không link. */
const SHOP_ID_PATTERN = /^\d{3,20}$/;
/** Key PosCake là một chuỗi liền không khoảng trắng. Chặn ở đây để không tốn round-trip nhận 400. */
const API_KEY_PATTERN = /^\S{10,300}$/;

const NO_PORT: ToolResult = {
  content:
    "Chức năng nạp tài khoản PosCake chưa sẵn sàng — báo đại lý là em chuyển Nhóm Hỗ trợ xử lý, " +
    "KHÔNG nói là đã nạp.",
  isError: true,
};

/**
 * Nhắc kèm MỌI kết quả nạp: key vừa gõ nằm trong lịch sử chat của nhóm này. Nhóm riêng của đại lý
 * thì chấp nhận được; lỡ gõ ở nhóm đông người thì phải thu hồi — luật này ở reference poscake.md.
 */
const KEY_EXPOSURE_NOTE =
  "Nhắc đại lý: API Key vừa gửi nằm trong lịch sử tin nhắn của nhóm này. Nếu nhóm có người ngoài " +
  "đọc được thì vào PosCake xoá key đó, tạo key mới rồi gửi lại — key PosCake có quyền ngang tài " +
  "khoản admin của shop.";

export function buildPoscakeRegisterTool(ctx: ToolContext): Tool {
  return {
    name: "nap_poscake",
    description:
      "GHI: nạp tài khoản PosCake (Pancake POS) của đại lý phòng này vào hệ thống, để đơn tạo trên " +
      "PosCake tự chảy về DILIM. Chỉ gọi KHI đại lý đã tự đưa ĐỦ CẢ HAI: Shop ID và API Key — " +
      "chép nguyên văn đại lý gửi, KHÔNG tự bịa, không lấy lại key cũ trong lịch sử chat nếu đại " +
      "lý không nhắc tới. Chưa có đủ hai thứ thì hướng dẫn lấy theo reference huong-dan/poscake.md " +
      "trước, đừng gọi tool. Tool KHÔNG dán webhook URL hộ (vận hành cấp riêng từng đại lý).",
    inputSchema: {
      type: "object",
      properties: {
        shop_id: {
          type: "string",
          description: "Shop ID PosCake — dãy số trong URL sau /shop/, vd 1234567.",
        },
        api_key: {
          type: "string",
          description:
            "API Key đại lý vừa tạo trong PosCake (Cấu hình → Kết nối bên thứ 3 → Webhook/API → " +
            "tab API Key). Chép nguyên văn, không cắt, không thêm dấu.",
        },
      },
      required: ["shop_id", "api_key"],
    },
    announce: "Dạ em nạp tài khoản PosCake vào hệ thống, chờ em chút ạ.",
    run: (input: unknown, signal?: AbortSignal): Promise<ToolResult> => run(ctx, input, signal),
  };
}

async function run(
  ctx: ToolContext,
  input: unknown,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  // Hàng rào vai TRƯỚC mọi thứ: người chưa định danh thì không nạp credential dưới tên đại lý.
  if (ctx.identity.role === ActorRole.Guest) {
    return {
      content:
        "Người đang gõ chưa được định danh là đại lý của phòng này nên chưa nạp được tài khoản " +
        "PosCake. Báo là cần chính đại lý (hoặc nhân viên phụ trách) gửi thông tin — KHÔNG nói là " +
        "đã nạp.",
      isError: true,
    };
  }

  const poscake = ctx.poscake;
  if (poscake === undefined) return NO_PORT;

  const principal = resolvePrincipal(ctx);
  if (principal === undefined) return NO_CUSTOMER;

  const shopId = readStringField(input, "shop_id");
  if (shopId === undefined || !SHOP_ID_PATTERN.test(shopId)) {
    return {
      content:
        'Thiếu hoặc sai "shop_id". Shop ID là DÃY SỐ trong thanh địa chỉ PosCake, ngay sau /shop/ ' +
        "(vd pos.pages.fm/shop/1234567/orders → 1234567). Hỏi lại đại lý đúng dãy số đó, không đoán.",
      isError: true,
    };
  }

  const apiKey = readStringField(input, "api_key");
  if (apiKey === undefined || !API_KEY_PATTERN.test(apiKey)) {
    return {
      content:
        'Thiếu hoặc sai "api_key" (phải là một chuỗi liền, không khoảng trắng). Hỏi lại đại lý ' +
        "chép nguyên văn key vừa tạo trong PosCake — KHÔNG đọc lại key nào trong tin nhắn cũ, " +
        "KHÔNG tự ghép.",
      isError: true,
    };
  }

  let result: PoscakeShopLink;
  try {
    result = await poscake.register({ ...principal, shopId, apiKey, signal });
  } catch (err) {
    if (err instanceof AgentApiError) return failure(err);
    throw err;
  }

  return { content: renderResult(result) };
}

/**
 * 4xx = hệ vận hành TỪ CHỐI (shop id lạ, key sai/đã tắt, đại lý không hợp lệ) → chưa ghi gì, đại lý
 * kiểm lại rồi gửi lại. 5xx/mạng = KHÔNG BIẾT đã ghi hay chưa → không được giục gửi lại key.
 *
 * KHÔNG in `err.message`: message mang body backend trả, mà body đó có thể lặp lại thứ vừa gửi lên.
 * Chỉ mã lỗi + status là đủ cho người vận hành tra.
 */
function failure(err: AgentApiError): ToolResult {
  console.error(`[nap_poscake] API vận hành lỗi: ${err.status} ${err.code} ${err.path}`);

  if (err.status >= 400 && err.status < 500) {
    return {
      content:
        `Hệ vận hành TỪ CHỐI thông tin PosCake vừa gửi (mã ${err.code}). Chưa nạp được. Báo đại lý ` +
        "kiểm lại Shop ID và kiểm key còn BẬT ở cột On/Off trong tab API Key, rồi gửi lại. Vẫn " +
        "không được thì chuyển Nhóm Hỗ trợ kèm Shop ID.",
      isError: true,
    };
  }

  return {
    content:
      `Hệ vận hành không phản hồi khi nạp tài khoản PosCake (mã ${err.code}). CHƯA CHẮC đã nạp ` +
      "được — báo đại lý là em đang kiểm tra lại và sẽ báo sau, ĐỪNG bảo họ gửi lại key ngay và " +
      "KHÔNG nói là đã nạp xong.",
    isError: true,
  };
}

function renderResult(result: PoscakeShopLink): string {
  return [
    "ĐÃ NẠP tài khoản PosCake vào hệ thống.",
    line("Shop ID", result.shopId),
    line("Đại lý", result.dealerCode),
    "Còn một bước ĐẠI LÝ tự làm: dán Webhook URL vào PosCake (Webhook/API → tab Webhook URL). Link " +
      "đó vận hành cấp riêng từng đại lý — agent KHÔNG có, không tự ghép; đại lý chưa có link thì " +
      "chuyển Nhóm Hỗ trợ.",
    KEY_EXPOSURE_NOTE,
  ]
    .filter((text): text is string => text !== undefined)
    .join("\n");
}
