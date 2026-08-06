// specs.ts — DistillSpec dựng sẵn. Mỗi spec = "agent này nhớ GÌ". Đây KHÔNG phải spec duy nhất:
// agent mới cần trí nhớ khác → khai spec riêng (ở agent đó hoặc thêm vào đây) rồi buildDistiller(spec).

import { MEMORY_TYPE_VALUES, MemoryType, type DistillSpec } from "./types.ts";

/** Agent hỗ trợ khách: nhớ dữ kiện bền CỦA PHÒNG chat, bỏ trace ephemeral. */
export const customerSupportSpec: DistillSpec = {
  system: [
    "Bạn là bộ chưng cất trí nhớ cho trợ lý hỗ trợ đại lý. Rút FACT BỀN đáng nhớ lâu dài về công",
    "việc của PHÒNG CHAT này (trong phòng có cả nhân viên lẫn khách).",
    "",
    "Chỉ giữ: sở thích/ràng buộc đã chốt, dữ kiện nền (đơn, sản phẩm, quan hệ), sự việc đã xảy ra.",
    "BỎ: nội dung công cụ trả thô, bước trung gian, câu xã giao, thông tin suy được từ hệ thống.",
    "MỖI fact phải tự nêu AI nói / fact thuộc về ai (dùng đúng định danh trong transcript). Fact",
    "đọc lại sau nhiều tháng vẫn phải biết là của ai — 'muốn giao thứ 5' mà không rõ ai là fact hỏng.",
    "Không bịa.",
  ].join("\n"),
  allowedTypes: MEMORY_TYPE_VALUES,
  defaultType: MemoryType.Context,
};

/**
 * Agent nội bộ (vận hành + lãnh đạo): nhớ VIỆC, không nhớ sở thích khách. Cùng một spec cho cả
 * hai vì thứ đáng nhớ giống nhau (quyết định, tồn đọng, bất thường) — khác nhau ở cách TRẢ LỜI,
 * và cái đó nằm ở prompt chứ không ở trí nhớ.
 */
export const internalOpsSpec: DistillSpec = {
  system: [
    "Bạn là bộ chưng cất trí nhớ cho trợ lý nội bộ của Dili. Rút FACT BỀN về CÔNG VIỆC đang chạy.",
    "",
    "Chỉ giữ: quyết định đã chốt (ai chốt, chốt gì), việc còn tồn đọng và người chịu trách nhiệm,",
    "ràng buộc vận hành (hạn, hạn mức, quy trình riêng), sự việc bất thường đã xảy ra.",
    "BỎ: số liệu tra cứu tức thời (tra lại được), bước trung gian, câu trao đổi xã giao.",
    "MỖI fact phải tự nêu AI quyết / việc thuộc về ai / liên quan đại lý nào. Fact đọc lại sau",
    "nhiều tháng vẫn phải biết là của ai — 'đã duyệt' mà không rõ duyệt gì là fact hỏng.",
    "Không bịa.",
  ].join("\n"),
  allowedTypes: MEMORY_TYPE_VALUES,
  defaultType: MemoryType.Episode,
};

/** Trợ lý riêng 1-1: nhớ về CHÍNH người đang chat, không nhớ việc của phòng nào. */
export const personalSpec: DistillSpec = {
  system: [
    "Bạn là bộ chưng cất trí nhớ cho trợ lý riêng. Rút FACT BỀN về CHÍNH người đang trò chuyện.",
    "",
    "Chỉ giữ: cách làm việc họ muốn (giọng văn, định dạng, thói quen), ràng buộc cá nhân đã nêu",
    "(lịch, ưu tiên, thứ họ không muốn), việc dài hạn họ đang theo.",
    "BỎ: nội dung tra cứu một lần, bước trung gian, câu xã giao.",
    "Fact phải tự đứng được khi đọc lại sau nhiều tháng. Không bịa.",
  ].join("\n"),
  allowedTypes: MEMORY_TYPE_VALUES,
  defaultType: MemoryType.Preference,
};
