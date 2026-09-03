// workflow-tools.test.ts — cửa GHI của tra_loi_viec: ai được đóng việc treo.
//
// Vụ PKE1487782361DH: trong chính lượt hệ thống tự phát để HỎI đại lý, model tự cắt đuôi DH rồi
// gọi tra_loi_viec — kho nhận "đại lý xác nhận" khi chưa ai nói gì. Lượt hỏi/nhắc mang senderId
// của workflow, nên đó là dấu hiệu chắc chắn "chưa có người trả lời". Người thật (đại lý hay nhân
// viên) thì ai trả lời cũng ghi được — không đòi đúng một vai.

import { describe, expect, test } from "bun:test";
import { PendingStatus } from "../db/schema.ts";
import type { Identity } from "../flash-command/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import type { SkillRegistry } from "../skills/registry.ts";
import type { AnswerOutcome, OpenOutcome } from "../workflows/engine.ts";
import type { AnswerRequestInput, OpenRequestInput, WorkflowPort } from "../workflows/service.ts";
import type { PendingRequest, RoomRef, WorkflowDef } from "../workflows/types.ts";
import { WORKFLOW_SENDER_ID } from "../workflows/types.ts";
import { buildWorkflowAnswerTool } from "./impl/workflow/answer.ts";
import type { ToolContext } from "./types.ts";

const skills: SkillRegistry = await buildSkillRegistry();

const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const STAFF: Identity = { role: "nhan_vien", senderId: "u3", userId: "77", roleSlug: "sale" };
/** Lượt hệ thống tự phát để hỏi/nhắc — auth resolve ra guest với senderId của workflow. */
const SYSTEM_ASK: Identity = { role: "guest", senderId: WORKFLOW_SENDER_ID };

const ROOM: RoomRef = { channel: "zalo", groupId: "group-42" };
const SUBJECT = "PKE1487782361DH";

const DEF: WorkflowDef = {
  name: "hoi-don-goc",
  subjectLabel: "mã đơn hoàn",
  answerLabel: "mã đơn gốc",
  targetLabel: "đại lý",
  ttlMs: 1,
  remindIntervalMs: 1,
  officeHoursOnly: false,
  normalizeSubject: (raw) => raw,
  normalizeAnswer: (raw) => raw,
  resolveTarget: () => Promise.resolve({ kind: "unknown_subject" }),
  askText: () => "",
  resultText: () => "",
};

const RECORDED: PendingRequest = {
  id: "p1",
  workflow: DEF.name,
  subject: SUBJECT,
  target: ROOM,
  origin: { channel: "zalo-kho", groupId: "kho-1" },
  requesterId: "kho-u1",
  state: {},
  askCount: 1,
  expiresAt: new Date(0),
  status: PendingStatus.Approved,
  answer: "PKE1487782361",
};

class FakeWorkflow implements WorkflowPort {
  readonly answered: AnswerRequestInput[] = [];
  catalog(): readonly WorkflowDef[] {
    return [DEF];
  }
  open(_input: OpenRequestInput): Promise<OpenOutcome | undefined> {
    return Promise.reject(new Error("không dùng trong test này"));
  }
  answer(input: AnswerRequestInput): Promise<AnswerOutcome | undefined> {
    this.answered.push(input);
    return Promise.resolve({ kind: "recorded", request: RECORDED });
  }
  openForTarget(): Promise<readonly PendingRequest[]> {
    return Promise.resolve([]);
  }
  openForOrigin(): Promise<readonly PendingRequest[]> {
    return Promise.resolve([]);
  }
}

function ctxFor(identity: Identity, workflow: FakeWorkflow): ToolContext {
  return { skills, identity, room: ROOM, workflow };
}

const INPUT = { ma_viec: DEF.name, khoa: SUBJECT, tra_loi: "PKE1487782361" };

describe("tra_loi_viec — ai được ghi", () => {
  test("lượt hệ thống tự hỏi → chặn, port KHÔNG được gọi", async () => {
    const workflow = new FakeWorkflow();
    const result = await buildWorkflowAnswerTool(ctxFor(SYSTEM_ASK, workflow)).run(INPUT);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("chưa có người");
    expect(workflow.answered).toHaveLength(0);
  });

  test("đại lý trả lời → ghi", async () => {
    const workflow = new FakeWorkflow();
    const result = await buildWorkflowAnswerTool(ctxFor(DEALER, workflow)).run(INPUT);
    expect(result.isError).toBeUndefined();
    expect(workflow.answered).toHaveLength(1);
    expect(workflow.answered[0]?.answeredBy).toBe(DEALER.senderId);
  });

  test("nhân viên trả lời thay đại lý → cũng ghi, không đòi đúng vai", async () => {
    const workflow = new FakeWorkflow();
    const result = await buildWorkflowAnswerTool(ctxFor(STAFF, workflow)).run(INPUT);
    expect(result.isError).toBeUndefined();
    expect(workflow.answered).toHaveLength(1);
  });
});
