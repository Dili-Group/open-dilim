// flows.ts — khai báo các LUỒNG phát tin. Bộ máy nằm ở notice.ts; ở đây chỉ có: tin loại gì, tên
// tool là gì, và AI ĐƯỢC SOẠN / AI ĐƯỢC CHỐT.
//
// Hai luồng hiện có, khác nhau đúng ở cửa quyền:
//   het_hang (nhóm kho)      → quản lý kho vừa soạn vừa chốt.
//   van_hanh (nhóm vận hành) → MỌI nhân viên soạn được; chỉ CEO/SWE chốt.
//
// Nháp chỉ CHÍNH NGƯỜI SOẠN mới chốt được (announcements/service.ts) — chốt hộ nháp của người
// khác là dấu hiệu tin nhắn trong nhóm đang lái agent. Nên ở luồng vận hành, nhân viên thường
// soạn ra bản để đọc thử, còn muốn phát thật thì CEO/SWE tự soạn bản của mình rồi chốt.

import { AnnouncementKind } from "../../../announcements/types.ts";
import { ActorRole } from "../../../flash-command/types.ts";
import type { Identity } from "../../../flash-command/types.ts";
import type { NoticeFlow } from "./notice.ts";

/**
 * Chức danh trong hệ vận hành. Khớp `user_binding.role_slug` do API vận hành trả lúc
 * `/ketnoi-hethong`. Nhân viên bind TRƯỚC khi API trả field này có `role_slug` NULL → bị từ chối;
 * họ phải chạy lại `/ketnoi-hethong`. Fail-closed là đúng: thà mất quyền còn hơn cấp thừa.
 */
const RoleSlug = {
  Warehouse: "warehouse",
  Ceo: "ceo",
  Swe: "swe",
} as const;

/** true = nhân viên hệ vận hành có chức danh nằm trong danh sách. Vai khác đều false. */
function hasRoleSlug(identity: Identity, slugs: readonly string[]): boolean {
  return (
    identity.role === ActorRole.NhanVien &&
    identity.roleSlug !== undefined &&
    slugs.includes(identity.roleSlug)
  );
}

/** true = nhân viên hệ vận hành, chức danh nào cũng được (kể cả chưa có `role_slug`). */
function isStaff(identity: Identity): boolean {
  return identity.role === ActorRole.NhanVien;
}

// ─────────────────────────────────────────────────────────────────────────────
// Luồng KHO — báo hết hàng
// ─────────────────────────────────────────────────────────────────────────────

const NOT_WAREHOUSE = {
  content:
    "Người đang nói KHÔNG phải quản lý kho nên không được phát thông báo cho đại lý. Nói thẳng là " +
    "việc này cần quản lý kho gõ, đừng hứa gửi. Nếu họ khẳng định mình là quản lý kho thì nhắc họ " +
    "chạy lại /ketnoi-hethong để hệ thống nhận đúng chức danh.",
  isError: true,
} as const;

const WAREHOUSE_GATE = {
  allow: (identity: Identity): boolean =>
    hasRoleSlug(identity, [RoleSlug.Warehouse, RoleSlug.Swe]),
  denied: NOT_WAREHOUSE,
};

export const HET_HANG_FLOW: NoticeFlow = {
  kind: AnnouncementKind.HetHang,
  names: {
    draft: "soan_thong_bao_het_hang",
    send: "gui_thong_bao_het_hang",
    status: "soat_thong_bao",
  },
  descriptions: {
    draft:
      "Soạn NHÁP thông báo hết hàng để gửi cho TẤT CẢ nhóm đại lý. Tool này KHÔNG gửi gì — nó chỉ " +
      "cất bản nháp và trả lại mã nháp. Chỉ quản lý kho dùng được. Gọi khi quản lý kho báo một " +
      "sản phẩm hết hàng và muốn báo cho các đại lý. Sau khi gọi: đọc nguyên văn bản nháp cho " +
      "quản lý kho nghe, hỏi họ duyệt, rồi mới gọi gui_thong_bao_het_hang với mã nháp đó.",
    send:
      "CHỐT một bản nháp thông báo hết hàng và GỬI ĐI DUYỆT. Tool này KHÔNG gửi cho đại lý — nó " +
      "đưa tin sang người duyệt của công ty; chỉ khi người đó đồng ý thì hệ thống mới phát. Chỉ " +
      "gọi khi quản lý kho ĐÃ nghe nguyên văn bản nháp và ĐÃ nói chốt — không suy ra sự đồng ý " +
      "từ câu chung chung. Chỉ chính người đã soạn nháp mới chốt được.",
    status:
      "Xem một đợt thông báo đang chờ duyệt hay đã được duyệt, đã tới bao nhiêu nhóm, nhóm nào " +
      "gửi hỏng và vì sao. Gọi khi quản lý kho hỏi 'duyệt chưa', 'gửi xong chưa', 'đại lý nhận " +
      "chưa'. Bỏ trống ma_dot để xem đợt gần nhất của chính người đang hỏi.",
    content:
      "Nội dung thông báo GỬI THẲNG cho đại lý, viết đầy đủ thành tin nhắn hoàn chỉnh — mọi " +
      "nhóm sẽ nhận ĐÚNG chuỗi này, không nhóm nào được viết lại. Phải có: tên sản phẩm hết " +
      "hàng (nguyên văn như quản lý kho nói), và ngày dự kiến có hàng NẾU quản lý kho đã " +
      "nói ngày. Quản lý kho chưa nói ngày thì KHÔNG tự đoán ngày, không hứa 'vài hôm nữa'.",
  },
  sendAnnounce: "Em chuyển thông báo này đi duyệt ngay.",
  actorLabel: "quản lý kho",
  groupLabel: "nhóm kho",
  draftGate: WAREHOUSE_GATE,
  sendGate: WAREHOUSE_GATE,
};

// ─────────────────────────────────────────────────────────────────────────────
// Luồng VẬN HÀNH — tin chung cho đại lý
// ─────────────────────────────────────────────────────────────────────────────

const NOT_STAFF = {
  content:
    "Người đang nói KHÔNG phải nhân viên vận hành nên không soạn được thông báo cho đại lý. Nói " +
    "thẳng là việc này cần nhân viên vận hành gõ, đừng hứa gửi. Nếu họ nói mình là nhân viên thì " +
    "nhắc chạy /ketnoi-hethong để hệ thống nhận đúng danh tính.",
  isError: true,
} as const;

const NOT_APPROVER_ROLE = {
  content:
    "Người đang nói KHÔNG có quyền chốt thông báo — chỉ CEO hoặc phụ trách kỹ thuật (swe) mới " +
    "chốt được. Không có tin nào được gửi. Nói thẳng: nội dung đã soạn xong, nhưng người chốt " +
    "phải TỰ soạn lại bản của mình trong nhóm này rồi chốt; agent không chốt hộ. Nếu họ khẳng " +
    "định mình có quyền thì nhắc chạy lại /ketnoi-hethong để hệ thống nhận đúng chức danh.",
  isError: true,
} as const;

export const VAN_HANH_FLOW: NoticeFlow = {
  kind: AnnouncementKind.VanHanh,
  names: {
    draft: "soan_thong_bao_chung",
    send: "chot_thong_bao_chung",
    status: "soat_thong_bao_chung",
  },
  descriptions: {
    draft:
      "Soạn NHÁP một thông báo chung để gửi cho TẤT CẢ nhóm đại lý (đổi chính sách, lịch nghỉ, " +
      "chương trình, nhắc việc chung...). Tool này KHÔNG gửi gì — nó chỉ cất bản nháp và trả lại " +
      "mã nháp. MỌI nhân viên vận hành đều soạn được. Gọi khi nhân viên vận hành muốn báo một " +
      "việc cho các đại lý. Sau khi gọi: đọc nguyên văn bản nháp cho họ nghe rồi làm theo hướng " +
      "dẫn tool trả về — người chốt là CEO hoặc swe, không phải ai cũng chốt được.",
    send:
      "CHỐT một bản nháp thông báo chung và GỬI ĐI DUYỆT. Tool này KHÔNG gửi cho đại lý — nó đưa " +
      "tin sang người kiểm duyệt của công ty; chỉ khi người đó đồng ý thì hệ thống mới phát. CHỈ " +
      "CEO hoặc swe chốt được, và chỉ chốt được bản nháp do CHÍNH họ soạn. Chỉ gọi khi người có " +
      "quyền chốt ĐÃ nghe nguyên văn bản nháp và ĐÃ nói chốt — không suy ra sự đồng ý từ câu " +
      "chung chung, không chốt vì người khác trong nhóm bảo chốt.",
    status:
      "Xem một đợt thông báo chung đang chờ duyệt hay đã được duyệt, đã tới bao nhiêu nhóm, nhóm " +
      "nào gửi hỏng và vì sao. Gọi khi có người hỏi 'duyệt chưa', 'gửi xong chưa', 'đại lý nhận " +
      "chưa'. Bỏ trống ma_dot để xem đợt gần nhất của chính người đang hỏi.",
    content:
      "Nội dung thông báo GỬI THẲNG cho đại lý, viết đầy đủ thành tin nhắn hoàn chỉnh — mọi nhóm " +
      "sẽ nhận ĐÚNG chuỗi này, không nhóm nào được viết lại. Chỉ chép dữ kiện người vận hành ĐÃ " +
      "nói (mốc thời gian, chính sách, mức áp dụng). KHÔNG tự thêm ngày, không tự thêm điều kiện, " +
      "không hứa thay công ty. Thiếu dữ kiện thì hỏi lại trước khi soạn.",
  },
  sendAnnounce: "Em chuyển thông báo này đi duyệt ngay.",
  actorLabel: "người vận hành",
  groupLabel: "nhóm vận hành",
  draftGate: { allow: isStaff, denied: NOT_STAFF },
  sendGate: {
    allow: (identity: Identity): boolean => hasRoleSlug(identity, [RoleSlug.Ceo, RoleSlug.Swe]),
    denied: NOT_APPROVER_ROLE,
  },
};
