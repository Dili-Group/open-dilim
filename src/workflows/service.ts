// service.ts — MỘT cổng duy nhất cho tool: tra danh mục nghiệp vụ, mở việc, trả lời việc, liệt kê
// việc đang treo của một nhóm.
//
// Tool KHÔNG cầm `WorkflowDeps` + `WorkflowRegistry` rời nhau: cầm hai thứ thì mỗi tool phải tự
// nhớ luật "resolve def trước, lỗi slug lạ thì trả gì" — và mỗi tool sẽ nhớ một kiểu. Gói ở đây,
// tool chỉ thấy một interface giống hệt `OrderPort`/`DailyPort` mà nó đã quen.

import { answerRequest, openRequest, type AnswerOutcome, type OpenOutcome } from "./engine.ts";
import type { WorkflowRegistry } from "./registry.ts";
import type { PendingRequest, RoomRef, WorkflowDef, WorkflowDeps } from "./types.ts";

/** Tham số mở việc, đã bỏ phần bộ máy tự biết (def). */
export interface OpenRequestInput {
  readonly workflow: string;
  readonly subject: string;
  readonly origin: RoomRef;
  readonly requesterId: string;
  readonly nowMs: number;
  readonly signal?: AbortSignal;
}

export interface AnswerRequestInput {
  readonly workflow: string;
  readonly subject: string;
  readonly answer: string;
  readonly targetRoom: RoomRef;
  readonly answeredBy: string;
  readonly nowMs: number;
}

/**
 * Cổng nghiệp vụ chờ-trả-lời cho tool. `undefined` trả về từ open/answer nghĩa là SLUG LẠ — tách
 * khỏi các kết cục nghiệp vụ khác vì đó là lỗi của model (gõ sai tên việc), không phải của dữ liệu.
 */
export interface WorkflowPort {
  /** Danh mục nghiệp vụ đang khai — tool render vào description cho model chọn đúng slug. */
  catalog(): readonly WorkflowDef[];
  open(input: OpenRequestInput): Promise<OpenOutcome | undefined>;
  answer(input: AnswerRequestInput): Promise<AnswerOutcome | undefined>;
  /** Việc nhóm này PHẢI trả lời. */
  openForTarget(room: RoomRef): Promise<readonly PendingRequest[]>;
  /** Việc nhóm này ĐÃ hỏi và còn đang chờ. */
  openForOrigin(room: RoomRef): Promise<readonly PendingRequest[]>;
}

export class WorkflowService implements WorkflowPort {
  constructor(
    private readonly deps: WorkflowDeps,
    private readonly registry: WorkflowRegistry,
  ) {}

  catalog(): readonly WorkflowDef[] {
    return this.registry.all();
  }

  async open(input: OpenRequestInput): Promise<OpenOutcome | undefined> {
    const def = this.registry.resolve(input.workflow);
    if (def === undefined) return undefined;
    return openRequest(this.deps, def, {
      subject: input.subject,
      origin: input.origin,
      requesterId: input.requesterId,
      nowMs: input.nowMs,
      signal: input.signal,
    });
  }

  async answer(input: AnswerRequestInput): Promise<AnswerOutcome | undefined> {
    const def = this.registry.resolve(input.workflow);
    if (def === undefined) return undefined;
    return answerRequest(this.deps, def, {
      subject: input.subject,
      answer: input.answer,
      targetRoom: input.targetRoom,
      answeredBy: input.answeredBy,
      nowMs: input.nowMs,
    });
  }

  openForTarget(room: RoomRef): Promise<readonly PendingRequest[]> {
    return this.deps.store.openForTarget(room);
  }

  openForOrigin(room: RoomRef): Promise<readonly PendingRequest[]> {
    return this.deps.store.openForOrigin(room);
  }
}
