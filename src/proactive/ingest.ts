// ingest.ts — đầu VÀO của phễu: gateway đưa tin group không nhắm agent qua đây (best-effort).
// Gộp tầng 0 (gate thuần) + đặt lịch chờ tầng 1. Không I/O nào ngoài Redis pending.

import { passesProactiveGate } from "./gate.ts";
import type { ProactivePendingStore } from "./pending.ts";
import type { ProactiveSpec } from "../agents/types.ts";
import type { Envelope } from "../types/index.ts";

export interface ProactiveIngestDeps {
  readonly pending: ProactivePendingStore;
  readonly specFor: (channel: string) => ProactiveSpec | undefined;
  /** Id "chính mình" theo kênh (agentUid + selfUid) — xem ProactiveGateInput.selfIds. */
  readonly selfIdsFor: (channel: string) => readonly string[];
}

export class ProactiveIngest {
  constructor(private readonly deps: ProactiveIngestDeps) {}

  /** Tin qua gate tầng 0 → đè lịch chờ của (phòng, người hỏi): câu mới nhất thắng, đồng hồ reset. */
  async consider(envelope: Envelope): Promise<void> {
    const spec = this.deps.specFor(envelope.channel);
    if (spec === undefined) return;
    const selfIds = this.deps.selfIdsFor(envelope.channel);
    if (!passesProactiveGate({ envelope, spec, selfIds })) return;

    await this.deps.pending.schedule(
      {
        channel: envelope.channel,
        conversationId: envelope.conversationId,
        senderId: envelope.senderId,
        ...(envelope.senderName === undefined ? {} : { senderName: envelope.senderName }),
        msgId: envelope.msgId,
        text: envelope.text,
        ts: envelope.ts,
      },
      Date.now() + spec.waitMs,
    );
  }
}
