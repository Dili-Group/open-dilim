// engine.ts — bộ máy chạy MỘT việc treo, dùng chung cho mọi nghiệp vụ:
//
//   openRequest   : nhóm A hỏi → ghi pending → đẩy 1 lượt cho agent nhóm B
//   answerRequest : người ở B trả lời → đóng pending → báo kết quả về A
//   dispatchAsk   : đẩy lượt hỏi (lần đầu và mỗi lần nhắc đều đi qua đây)
//
// GHI DB TRƯỚC KHI HỎI, luôn luôn. Đảo thứ tự thì có lúc bên kia nhận câu hỏi mà hệ thống không
// có chỗ nhận câu trả lời — họ trả lời vào khoảng không, và không ai biết là đã mất.
//
// Kết quả là GIÁ TRỊ (union), không phải exception: mọi ngã rẽ ("đang chờ rồi", "không tra được",
// "chưa có nhóm") là kết cục NGHIỆP VỤ mà tool phải diễn đạt lại, không phải lỗi kỹ thuật.

import { capForChannel } from "../broadcast/limits.ts";
import { AGENT_SENDER_ID, type Envelope, type HistoryEntry } from "../types/index.ts";
import { expiresAt, nextRemindAt } from "./schedule.ts";
import {
  WORKFLOW_SENDER_ID,
  type PendingRequest,
  type RoomRef,
  type WorkflowDef,
  type WorkflowDeps,
} from "./types.ts";

/** Đích của việc treo là NHÓM (nhóm làm việc), không có đường DM cho nghiệp vụ này. */
const TARGET_IS_GROUP = true;

// ─────────────────────────────────────────────────────────────────────────────
// Mở việc
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenInput {
  /** Khoá thô người/model gõ — def tự chuẩn hoá. */
  readonly subject: string;
  /** Nhóm đang hỏi. */
  readonly origin: RoomRef;
  /** senderId người hỏi — để @ lại lúc báo kết quả. */
  readonly requesterId: string;
  readonly nowMs: number;
  readonly signal?: AbortSignal;
}

/**
 * Kết cục một lần mở việc:
 *  - asked          : đã ghi pending + đã đẩy lượt hỏi sang nhóm đích. `selfRoom` = nhóm đích CHÍNH
 *                     LÀ nhóm đang hỏi → không đẩy lượt nào (agent đã ở đó, tự hỏi luôn).
 *  - already_open   : khoá này đang chờ trả lời (không hỏi lại, không nhân đôi).
 *  - already_answered: khoá này đã có đáp án từ trước → trả luôn, không phiền nhóm kia.
 *  - invalid_subject: khoá không hợp lệ theo def (gõ sai/rỗng).
 *  - unknown_subject: hệ thống không biết khoá này.
 *  - no_room        : biết chủ nhưng chưa có nhóm nào để hỏi.
 *  - failed         : gọi hệ ngoài hỏng — THỬ LẠI ĐƯỢC, khác hẳn `unknown_subject`.
 */
export type OpenOutcome =
  | { readonly kind: "asked"; readonly request: PendingRequest; readonly selfRoom: boolean }
  | { readonly kind: "already_open"; readonly request: PendingRequest }
  | { readonly kind: "already_answered"; readonly request: PendingRequest }
  | { readonly kind: "invalid_subject" }
  | { readonly kind: "unknown_subject" }
  | { readonly kind: "no_room"; readonly detail: string }
  | { readonly kind: "failed"; readonly reason: string };

export async function openRequest(
  deps: WorkflowDeps,
  def: WorkflowDef,
  input: OpenInput,
): Promise<OpenOutcome> {
  const subject = def.normalizeSubject(input.subject);
  if (subject === undefined) return { kind: "invalid_subject" };

  // Hỏi lại thứ đang chờ = làm phiền bên kia hai lần cho cùng một khoá. Kiểm TRƯỚC khi gọi hệ ngoài.
  const open = await deps.store.findOpen(def.name, subject);
  if (open !== undefined) return { kind: "already_open", request: open };

  const answered = await deps.store.findAnswered(def.name, subject);
  if (answered !== undefined) return { kind: "already_answered", request: answered };

  const target = await def.resolveTarget(subject, input.signal);
  if (target.kind === "unknown_subject") return { kind: "unknown_subject" };
  if (target.kind === "no_room") return { kind: "no_room", detail: target.detail };
  // Lý do hỏng chỉ đi vào ToolResult cho model đọc — model diễn đạt lại thành "lỗi tra cứu" rồi
  // lý do biến mất. Log ra để còn truy được vì sao việc này KHÔNG BAO GIỜ được mở.
  if (target.kind === "failed") {
    console.error(`[workflows] ${def.name}: tra đích cho "${subject}" hỏng — ${target.reason}`);
    return { kind: "failed", reason: target.reason };
  }

  const request = await deps.store.open({
    workflow: def.name,
    subject,
    target: target.room,
    origin: input.origin,
    requesterId: input.requesterId,
    state: target.state ?? {},
    nextRemindAt: nextRemindAt(def, input.nowMs),
    expiresAt: expiresAt(def, input.nowMs),
  });
  // null = instance khác vừa mở việc cho đúng khoá này giữa hai lượt kiểm ở trên (unique index
  // bắt được). Đọc lại row của họ và coi như "đang chờ rồi" — không hỏi bên kia lần thứ hai.
  if (request === null) {
    const raced = await deps.store.findOpen(def.name, subject);
    if (raced === undefined) {
      // INSERT bị chặn nhưng đọc lại không thấy row nào: index chặn vì lý do KHÁC (vd đụng
      // idempotency_key), không phải vì đang có việc treo. Không log thì ca này vô hình.
      console.error(`[workflows] ${def.name}: INSERT cho "${subject}" bị chặn mà không có việc treo nào.`);
      return { kind: "failed", reason: `không mở được việc cho ${subject}` };
    }
    return { kind: "already_open", request: raced };
  }

  // Nhóm đích TRÙNG nhóm đang hỏi (nhóm này vừa là kho vừa là nhóm đại lý chủ đơn): đẩy lượt hỏi
  // = tự bắn cho chính mình một lượt agent nữa trong cùng phòng → người dùng thấy hai lần "để em
  // kiểm tra" và hai câu trả lời cho một tin. Việc vẫn ghi pending (để nhận đáp án + nhắc lại),
  // chỉ bỏ cú đẩy: agent đang đứng sẵn trong phòng, hỏi thẳng ở lượt này.
  const selfRoom = sameRoom(request.target, request.origin);
  if (!selfRoom) await dispatchAsk(deps, def, request, input.nowMs);
  return { kind: "asked", request, selfRoom };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trả lời việc
// ─────────────────────────────────────────────────────────────────────────────

export interface AnswerInput {
  readonly subject: string;
  readonly answer: string;
  /** Nhóm đang trả lời — phải khớp nhóm đã được hỏi. */
  readonly targetRoom: RoomRef;
  /** senderId người trả lời (audit). */
  readonly answeredBy: string;
  readonly nowMs: number;
}

/**
 * Kết cục ghi đáp án:
 *  - recorded      : đã đóng việc + đã báo kết quả về nhóm đã hỏi.
 *  - invalid_answer: đáp án không hợp lệ theo def → KHÔNG đóng việc.
 *  - not_found     : nhóm này không có việc treo nào mang khoá đó (gõ sai, hoặc việc của nhóm
 *                    khác). Kèm danh sách khoá ĐANG chờ CỦA NHÓM NÀY để model hỏi lại cho đúng.
 *  - closed        : việc vừa bị đóng bởi lượt khác → KHÔNG báo kết quả lần hai.
 */
export type AnswerOutcome =
  | { readonly kind: "recorded"; readonly request: PendingRequest }
  | { readonly kind: "invalid_answer" }
  | { readonly kind: "not_found"; readonly openSubjects: readonly string[] }
  | { readonly kind: "closed" };

export async function answerRequest(
  deps: WorkflowDeps,
  def: WorkflowDef,
  input: AnswerInput,
): Promise<AnswerOutcome> {
  const subject = def.normalizeSubject(input.subject);
  const answer = def.normalizeAnswer(input.answer);
  if (answer === undefined) return { kind: "invalid_answer" };

  const found = subject === undefined ? undefined : await deps.store.findOpen(def.name, subject);
  // Không tìm thấy, HOẶC tìm thấy nhưng của nhóm khác → cùng một câu trả lời: nhóm này không có
  // việc đó. KHÔNG tiết lộ rằng khoá đó đang treo ở nhóm nào khác.
  if (found === undefined || !sameRoom(found.target, input.targetRoom)) {
    const open = await deps.store.openForTarget(input.targetRoom);
    return {
      kind: "not_found",
      openSubjects: open
        .filter((item) => item.workflow === def.name)
        .map((item) => item.subject)
        .filter((value): value is string => value !== undefined),
    };
  }

  const resolved = await deps.store.resolve({
    id: found.id,
    answer,
    resolvedBy: input.answeredBy,
  });
  if (resolved === undefined) return { kind: "closed" };

  await notifyOrigin(deps, def, resolved, input.nowMs);
  return { kind: "recorded", request: resolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Đẩy lượt hỏi sang nhóm đích
// ─────────────────────────────────────────────────────────────────────────────

/**
 * msgId idempotent theo (việc, lần hỏi thứ mấy): tick trùng / hai instance cùng nhắc → dedupe nuốt
 * cái thứ hai. KHÔNG dùng Date.now() — hai instance lệch đồng hồ vẫn phải ra cùng một id.
 */
export function askMsgId(requestId: string, askCount: number): string {
  return `wf:${requestId}:${askCount}`;
}

/** Envelope lượt hỏi. Tách hàm để test khẳng định được shape mà không cần Redis. */
export function buildAskEnvelope(
  def: WorkflowDef,
  request: PendingRequest,
  nowMs: number,
  isReminder: boolean,
): Envelope {
  return {
    // Cùng loại với scheduler: lượt do HỆ THỐNG phát, không qua gateway. Tiền tố `wf:` của msgId
    // mới là thứ phân biệt lượt hỏi việc treo với lượt cron.
    source: "cron",
    channel: request.target.channel,
    msgId: askMsgId(request.id, request.askCount),
    conversationId: request.target.groupId,
    // Vai vẫn do AUTH resolve từ senderId này → guest. Lượt hỏi KHÔNG mang sẵn quyền gì; phạm vi
    // dữ liệu của tool lấy từ chủ nhóm như mọi lượt khác.
    senderId: WORKFLOW_SENDER_ID,
    isGroup: TARGET_IS_GROUP,
    // Không ai "nhắc" agent, nhưng lượt này sinh ra để agent chạy → qua thẳng trigger gate.
    addressedToAgent: true,
    text: def.askText(request, isReminder),
    mentions: [],
    ts: nowMs,
  };
}

/**
 * Đẩy một lượt hỏi vào nhóm đích: dedupe → history → publish (đúng thứ tự của ingest/scheduler).
 *
 * Ghi history là BẮT BUỘC: agent đọc việc-phải-làm từ history nhóm, và worker coi history rỗng là
 * lượt hỏng. Bỏ bước này thì lượt hỏi nào cũng chết ở bước STATE.
 *
 * false = dedupe đã thấy msgId này → không đẩy nữa (lần hỏi đó đã đi rồi).
 */
export async function dispatchAsk(
  deps: WorkflowDeps,
  def: WorkflowDef,
  request: PendingRequest,
  nowMs: number,
  isReminder = false,
): Promise<boolean> {
  const envelope = buildAskEnvelope(def, request, nowMs, isReminder);

  const first = await deps.dedupe.firstSee(envelope.channel, envelope.msgId);
  if (!first) return false;

  await deps.history.append(toHistoryEntry(envelope));
  await deps.broker.publish(envelope);
  return true;
}

/**
 * Gửi kết quả về nhóm đã hỏi + ghi vào history nhóm đó.
 *
 * TEMPLATE cố định, KHÔNG qua LLM: đây là dữ kiện, và lúc này (1-2 ngày sau) không còn lượt agent
 * nào của nhóm đó đang chạy để mà nhờ soạn câu.
 *
 * Broadcast hỏng thì THROW: mất tin này là bên hỏi không bao giờ biết đáp án, mà việc thì đã đóng
 * → caller phải thấy lỗi. Ghi history hỏng thì chỉ log: tin đã tới nơi rồi.
 */
async function notifyOrigin(
  deps: WorkflowDeps,
  def: WorkflowDef,
  request: PendingRequest,
  nowMs: number,
): Promise<void> {
  const text = def.resultText(request);
  await deps.broadcaster.send(
    {
      channel: request.origin.channel,
      conversationId: request.origin.groupId,
      isGroup: true,
      replyToSenderId: request.requesterId,
    },
    capForChannel(request.origin.channel, text),
  );

  try {
    await deps.history.append({
      conversationId: request.origin.groupId,
      msgId: `wf-result:${request.id}`,
      senderId: AGENT_SENDER_ID,
      text,
      isGroup: true,
      role: "agent",
      ts: nowMs,
    });
  } catch (err) {
    console.error(`[workflows] ghi kết quả ${request.id} vào history nhóm hỏi lỗi:`, err);
  }
}

/**
 * Lượt hỏi vào history với `role: "user"`: agent phải ĐỌC nó như một yêu cầu cần làm. Ghi
 * `role: "agent"` thì model coi đó là lời của chính mình và không làm gì.
 */
function toHistoryEntry(envelope: Envelope): HistoryEntry {
  return {
    conversationId: envelope.conversationId,
    msgId: envelope.msgId,
    senderId: envelope.senderId,
    text: envelope.text,
    isGroup: envelope.isGroup,
    role: "user",
    ts: envelope.ts,
  };
}

function sameRoom(a: RoomRef, b: RoomRef): boolean {
  return a.channel === b.channel && a.groupId === b.groupId;
}
