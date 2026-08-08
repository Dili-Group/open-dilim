// speaker-block.ts — khối "NGƯỜI ĐANG NHẮN LƯỢT NÀY" trong system prompt.
//
// TẠI SAO PHẢI CÓ: vai người gõ (nhân viên / đại lý / khách) trước đây CHỈ đi vào tầng tool (gate
// phạm vi + tool `whoami`), không đi vào prompt. History thì chỉ mang `senderId` thô — chat 1-1 còn
// không có prefix nào. Model vì thế không phân biệt được nhân viên nội bộ với đại lý, nên việc treo
// hỏi đại lý (§6) vẫn bị đòi vào mặt nhân viên vừa nhắn.
//
// KHÔNG để model tự suy ra: `whoami` chỉ chạy khi model NGHĨ RA là phải gọi, mà lúc cần biết vai
// nhất chính là lúc nó tưởng đã biết. Vai là dữ kiện của mọi lượt → bơm thẳng vào ngữ cảnh.
//
// Khối này BIẾN ĐỘNG (đổi theo từng người gõ trong cùng phòng) → phải nằm sau breakpoint prompt
// cache. Xem assembler.ts.

/**
 * Vai người gõ, đã rút gọn cho khối ngữ cảnh — context/ KHÔNG import `Identity` của flash-command
 * (giữ tầng lá, giống `PendingNotice` với tầng workflows). Wiring map Identity → cái này.
 */
export interface TurnSpeaker {
  readonly role: "nhan_vien" | "dai_ly" | "guest";
  /** Nhân viên: userId hệ vận hành. Đại lý: customerId. Guest: không có. */
  readonly id?: string;
  /** Tên hiển thị. undefined = hệ thống KHÔNG biết tên → model gọi theo vai, tuyệt đối không đoán. */
  readonly name?: string;
}

const HEADER = "NGƯỜI ĐANG NHẮN LƯỢT NÀY:";

/** undefined → chuỗi rỗng (assembler tự bỏ khối rỗng). */
export function renderSpeakerBlock(speaker: TurnSpeaker | undefined): string {
  if (speaker === undefined) return "";
  return `${HEADER} ${describe(speaker)}`;
}

function describe(speaker: TurnSpeaker): string {
  const who = `${name(speaker)}${suffix(speaker)}`;
  switch (speaker.role) {
    case "nhan_vien":
      return `${who} — người cùng công ty, KHÔNG phải khách/đại lý.`;
    case "dai_ly":
      return `${who} — khách của công ty.`;
    case "guest":
      return "Chưa định danh — chưa rõ là nhân viên hay đại lý, đừng đoán.";
  }
}

/** Vai đứng trước tên: vai quyết định cách xử sự, tên chỉ để gọi. Không có tên thì chỉ vai. */
function name(speaker: TurnSpeaker): string {
  const role = speaker.role === "nhan_vien" ? "Nhân viên nội bộ Dilim" : "Đại lý";
  return speaker.name === undefined ? role : `${role} ${speaker.name}`;
}

function suffix(speaker: TurnSpeaker): string {
  return speaker.id === undefined ? "" : ` (${idLabel(speaker.role)}=${speaker.id})`;
}

function idLabel(role: TurnSpeaker["role"]): string {
  return role === "nhan_vien" ? "userId" : "customerId";
}
