// retail-catalog.ts — danh mục SKU bán lẻ, đưa thẳng vào mô tả `tra_gia_le`.
//
// Tại sao cần: khách gửi ẢNH hộp hàng, model đọc nhãn ra tên kiểu "Coenzyme Q10 dạng khử" — tìm
// ILIKE theo chuỗi đó không ra "Rich Coenzyme Q10". Có danh mục trước mặt, model tự đối chiếu
// nhãn/hoạt chất với tên rồi truyền MÃ, tool khỏi phải đoán qua ô tìm kiếm.
//
// Chỉ hàng bán cho khách: thùng carton, bình giữ nhiệt (vật tư/quà) cố ý không có ở đây.

import type { RetailCartLine, RetailProduct, RetailQuote } from "../../operational/types.ts";

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

/**
 * Giá lẻ niêm yết một đơn vị (VNĐ). Tại sao nằm ở đây: `/pricing-vector/recommend` trả null khi
 * không combo nào rẻ hơn giá lẻ — mua 1 hộp là ca phổ biến nhất mà lại không có con số nào để
 * báo. Đổi giá niêm yết thì sửa bảng này.
 */
const RETAIL_PRICE_BY_SKU: Readonly<Record<string, number>> = {
  AFCDAUGOI: 850_000,
  AFCDAUXA: 850_000,
  AFCDUONGTOC: 1_050_000,
  AFCGIAMMO: 675_000,
  AFCRICH: 2_890_000,
  BIO240: 1_400_000,
  CLGBH: 990_000,
  DHA330: 3_290_000,
  FACE3D: 1_890_000,
  FCDEX150: 4_473_500,
  FCDKEN: 15_990_000,
  FCDNAWAPL: 1_490_000,
  GDG180: 2_500_000,
  GDG330: 3_890_000,
  GELNMN: 1_990_000,
  GLU: 680_000,
  HAUNN: 1_990_000,
  MXNBH: 1_290_000,
  NMN27: 8_390_000,
  NMTNB: 990_000,
  NTDL120: 2_290_000,
  NTNC120: 2_290_000,
  OMEGA: 1_390_000,
  PEELINGGEL: 1_490_000,
  SCMNB: 1_990_000,
  NMNSOAP: 1_690_000,
  TCC: 1_490_000,
  RAYDEL: 1_650_000,
  KCN: 1_290_000,
  INSUNA: 880_000,
  BOPHOI: 1_990_000,
  GOUT: 1_990_000,
};

/**
 * Giá lẻ cộng dồn của giỏ, không chương trình. undefined khi có SKU chưa có trong bảng giá —
 * báo thiếu một dòng là báo sai tổng.
 */
export function quoteAtRetailPrice(lines: readonly RetailCartLine[]): RetailQuote | undefined {
  let total = 0;
  for (const line of lines) {
    const price = RETAIL_PRICE_BY_SKU[line.sku];
    if (price === undefined) return undefined;
    total += price * line.quantity;
  }
  return { optimal: total, retailTotal: total, savings: 0, campaigns: [] };
}

/** Khớp đúng mã (không phân biệt hoa thường) — mã trong danh mục khỏi phải qua ô tìm kiếm. */
export function findCatalogProduct(query: string): RetailProduct | undefined {
  const wanted = query.trim().toUpperCase();
  return RETAIL_CATALOG.find((product) => product.sku === wanted);
}

/** Một dòng một sản phẩm, gọn để nằm trong mô tả tool. */
export function renderCatalog(): string {
  return RETAIL_CATALOG.map((product) => `${product.sku}: ${product.name}`).join("\n");
}
