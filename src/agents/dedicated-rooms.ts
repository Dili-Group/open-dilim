// dedicated-rooms.ts — PHÒNG CHUYÊN DỤNG: một nhóm cụ thể trên một kênh đã có, được phục vụ bởi
// agent khác với agent mặc định của kênh đó (docs/architecture/13-xac-nhan-don-bac-si.md §2).
//
// Vì sao cần bậc này: nhóm xác nhận đơn của BS Sơn nằm trên CHÍNH tài khoản Zalo đại lý. Tra theo
// channel như cũ thì mọi tin của nhóm rơi vào agent đại lý — sai persona, và agent đó cầm
// ORDER_TOOLS/DEALER_TOOLS theo đại lý chủ phòng, thứ nhóm nội bộ này không có.
//
// Hai thứ tách nhau rõ ràng:
//   - POLICY (agent nào, tin nào tính là một lượt) = hằng trong file này, review được, test được.
//   - ID NHÓM = dữ kiện hạ tầng của một lần triển khai (tạo lại nhóm là đổi id) → env, giống
//     `agentUid`/`webhookSecret`. Thiếu env = KHÔNG có phòng chuyên dụng nào (fail-closed): nhóm
//     đó chạy y như trước, agent của kênh trả lời.
//
// File LÁ: không import config.ts, không I/O. Bootstrap ghép id từ env vào policy ở đây rồi
// chuyền xuống router / ingest / worker / phễu proactive — ba nơi PHẢI đọc cùng một danh sách, lệch nhau
// là tin vào tới worker rồi bị agent khác trả lời.

import { AgentType } from "./types.ts";

export interface DedicatedRoom {
  readonly channel: string;
  readonly groupId: string;
  readonly agentType: AgentType;
  /**
   * Khuôn tin CHẮC CHẮN là việc của phòng: khớp MỘT mẫu → chạy lượt ngay, KHÔNG hỏi model phán
   * quyết. Rẻ hơn, không phụ thuộc mạng, và tin đăng ký (tên khách, SĐT, bệnh) không phải đi sang
   * nhà cung cấp ngoài chỉ để biết điều mà regex đã biết.
   */
  readonly templateTriggers: readonly RegExp[];
  /**
   * Tin KHÔNG khớp khuôn (sửa, báo kết quả, hỏi sổ, gõ lệch mẫu) → worker hỏi model phán quyết xem
   * tin có thuộc một trong các loại này không. Viết như nói với người mới vào nghề: đây là thứ
   * DUY NHẤT câu hỏi đối chiếu.
   */
  readonly intakeKinds: readonly string[];
}

/**
 * Mẫu tin thật sale đang gõ trong nhóm xác nhận (soát 18 tin 29/09–02/10/2026, tin nào cũng có):
 *
 *   STT: 8 NVH ( đã kí rule)      Stt 4 MKA  ( đã ký rule)       STT 1: NVH ( đã ký rule )
 *   1, Tên KH: ...                1. Ten KH : Chị Mới : 86639     1. Tên Kh : chị Cẩm (43679)
 *   STT:   3 NTA ( đã kí rule)    STT 05 VĐĐ (đã ký rule)         Stt 05 nvh(đã kí rule)
 *
 * Nên vạch đặt ở CHỮ "STT" đầu dòng, không đặt ở dấu phân cách hay số trường: mỗi người gõ một
 * kiểu ngăn cách, nhưng ai cũng mở bằng STT. Cờ `m` để tin có dòng chào phía trên vẫn lọt.
 *
 * Khớp = chạy thẳng, không qua phán quyết (`templateTriggers`). Tin lệch khuôn mới hỏi model.
 */
const XACNHAN_TRIGGERS: readonly RegExp[] = [/^\s*stt\s*[:.\-–]?\s*\d+/im];

/**
 * Loại tin đáng một lượt trong nhóm xác nhận. Gồm cả tin SỬA/BỔ SUNG — không chỉ tin mở bằng
 * STT: "khách Trang đổi sang khung chiều nhé" không có mẫu nào mà vẫn là việc của sổ.
 *
 * Agent CHỈ GHI ĐĂNG KÝ (chốt 02/10/2026): báo kết quả, hỏi hàng đợi, tổng hợp KHÔNG có ở đây —
 * không có tool cho mấy việc đó, đánh thức agent chỉ để nói "không làm được" là spam nhóm.
 */
const XACNHAN_INTAKE_KINDS: readonly string[] = [
  "đăng ký xin bác sĩ xác nhận cho một khách (tên khách, số điện thoại, tình trạng, lý do cần xác nhận, khung giờ) — kể cả gõ thiếu mục hay lệch mẫu",
  "sửa hoặc bổ sung một đăng ký đã gửi (đổi khung giờ, thêm lý do, sửa tên hay số khách, huỷ đăng ký gửi xác nhận)",
];

/**
 * Nhóm xác nhận đơn (kênh `zalo`, tài khoản đại lý sẵn có). `groupId` undefined = chưa khai env
 * `ZALO_XACNHAN_GROUP_ID` → trả undefined, agent này TẮT hoàn toàn.
 */
export function xacNhanRoom(groupId: string | undefined): DedicatedRoom | undefined {
  const id = groupId?.trim();
  if (id === undefined || id === "") return undefined;
  return {
    channel: "zalo",
    groupId: id,
    agentType: AgentType.OrderConfirm,
    templateTriggers: XACNHAN_TRIGGERS,
    intakeKinds: XACNHAN_INTAKE_KINDS,
  };
}

/** Phòng chuyên dụng khớp (kênh, nhóm). `groupId` undefined = chat 1-1 → không bao giờ khớp. */
export function dedicatedRoomOf(
  rooms: readonly DedicatedRoom[],
  channel: string,
  groupId: string | undefined,
): DedicatedRoom | undefined {
  if (groupId === undefined) return undefined;
  const key = channel.toLowerCase();
  return rooms.find((room) => room.channel === key && room.groupId === groupId);
}

/** Tin có khớp khuôn chắc chắn của phòng không — 0 token, chạy trước phán quyết (worker/intake.ts). */
export function matchesTemplate(room: DedicatedRoom, text: string): boolean {
  return room.templateTriggers.some((pattern) => pattern.test(text));
}
