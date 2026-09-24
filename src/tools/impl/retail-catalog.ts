// retail-catalog.ts — danh mục SKU bán lẻ, đưa thẳng vào mô tả `tra_gia_le`.
//
// Tại sao cần: khách gửi ẢNH hộp hàng, model đọc nhãn ra tên kiểu "Coenzyme Q10 dạng khử" — tìm
// ILIKE theo chuỗi đó không ra "Rich Coenzyme Q10". Có danh mục trước mặt, model tự đối chiếu
// nhãn/hoạt chất với tên rồi truyền MÃ, tool khỏi phải đoán qua ô tìm kiếm.
//
// Chỉ hàng bán cho khách: thùng carton, bình giữ nhiệt (vật tư/quà) cố ý không có ở đây.

import type { RetailProduct } from "../../operational/types.ts";

export const RETAIL_CATALOG: readonly RetailProduct[] = [
  { sku: "AFCDAUGOI", name: "Dầu gội AFC Soukaikan Amino Acid Shampoo 500ml" },
  { sku: "AFCDAUXA", name: "Kem xả Soukaikan Amino Acid Treatment 240gr" },
  { sku: "AFCDUONGTOC", name: "Xịt dưỡng tóc AFC Soukaikan Hair Tonic 120ml" },
  { sku: "AFCGIAMMO", name: "Viên uống AFC Nhật Bản Ellagic Acid 60 viên - 30 ngày" },
  { sku: "AFCRICH", name: "Rich Coenzyme Q10" },
  { sku: "BIO240", name: "Bioginko 240" },
  { sku: "CLGBH", name: "BH Collagen Rich" },
  { sku: "DHA330", name: "DHA-EPA-SQ" },
  { sku: "FACE3D", name: "Nano NMN + 3D face Mask" },
  { sku: "FCDEX150", name: "Mozuku Seaweed extract processed food, EX Fucoidan" },
  { sku: "FCDKEN", name: "Nano Fucoidan Kengen" },
  { sku: "FCDNAWAPL", name: "Okinawa Fucoidan Plus" },
  { sku: "GDG180", name: "Viên uống Giải độc Gan Plus Nano Nichiei Bussan - 180 Viên" },
  { sku: "GDG330", name: "Viên uống Giải độc Gan Nano Nichiei Bussan - 330 Viên" },
  { sku: "GELNMN", name: "Nano NMN + All in one Gel" },
  { sku: "GLU", name: "Gluchon Gel" },
  { sku: "HAUNN", name: "Nano Oyster Gold" },
  { sku: "MXNBH", name: "Nano Intestines Beauty Queen - Hộp" },
  { sku: "NMN27", name: "NMN 27000" },
  { sku: "NMTNB", name: "Nghệ mùa thu - Nhật Bản" },
  { sku: "NTDL120", name: "DiLi Nano Nattokinase Premium - 120 viên" },
  { sku: "NTNC120", name: "NC Nano Nattokinase Premium - 120 viên/Hộp" },
  { sku: "OMEGA", name: "PUREVITAL OMEGA 3 (60 viên)" },
  { sku: "PEELINGGEL", name: "Nano NMN + Peeling Gel" },
  { sku: "SCMNB", name: "Nano Premium SHARK CARTILAGE - 150 viên" },
  { sku: "NMNSOAP", name: "Nano NMN + Foaming Soap" },
  { sku: "TCC", name: "Nano Growth Habit EX" },
  { sku: "RAYDEL", name: "Thực phẩm bảo vệ sức khỏe POLICOSANOL 10 - RAYDEL" },
  { sku: "KCN", name: "Kem Chống Nắng NMN" },
  { sku: "INSUNA", name: "INSUNA - Viên hỗ trợ ổn định đường huyết" },
  { sku: "BOPHOI", name: "Nano Premium High Guard" },
  { sku: "GOUT", name: "Nano Anserine Premium" },
];

/** Khớp đúng mã (không phân biệt hoa thường) — mã trong danh mục khỏi phải qua ô tìm kiếm. */
export function findCatalogProduct(query: string): RetailProduct | undefined {
  const wanted = query.trim().toUpperCase();
  return RETAIL_CATALOG.find((product) => product.sku === wanted);
}

/** Một dòng một sản phẩm, gọn để nằm trong mô tả tool. */
export function renderCatalog(): string {
  return RETAIL_CATALOG.map((product) => `${product.sku}: ${product.name}`).join("\n");
}
