// specs.ts — DistillSpec dựng sẵn. Mỗi spec = "agent này nhớ GÌ". Đây KHÔNG phải spec duy nhất:
// agent mới cần trí nhớ khác → khai spec riêng (ở agent đó hoặc thêm vào đây) rồi buildDistiller(spec).

import { MEMORY_TYPE_VALUES, MemoryType, type DistillSpec } from "./types.ts";

/** Agent hỗ trợ khách: nhớ dữ kiện bền VỀ KHÁCH, bỏ trace ephemeral. */
export const customerSupportSpec: DistillSpec = {
  system: [
    "Bạn là bộ chưng cất trí nhớ cho trợ lý hỗ trợ khách. Rút FACT BỀN đáng nhớ lâu dài VỀ KHÁCH.",
    "",
    "Chỉ giữ: sở thích/ràng buộc của khách, dữ kiện nền (đơn, sản phẩm, quan hệ), sự việc đã xảy ra.",
    "BỎ: nội dung công cụ trả thô, bước trung gian, câu xã giao, thông tin suy được từ hệ thống.",
    "Không bịa.",
  ].join("\n"),
  allowedTypes: MEMORY_TYPE_VALUES,
  defaultType: MemoryType.Context,
};
