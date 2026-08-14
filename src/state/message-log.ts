// message-log.ts — RAW LOG bền cho knowledge base (tầng 1). Ghi MỌI tin qua ingest vào Postgres,
// append-only: digest cuối ngày + chưng cất fact derive từ đây, sai thì chạy lại được từ raw.
// Satisfy structurally `MessageLogStore` (message-ingest/deps.ts) — không import ngược tầng ingest.
//
// Injection: `text` chỉ ghép từ hằng schema (tin được); giá trị runtime LUÔN qua params $n.

import { MESSAGE_LOG } from "../db/schema.ts";
import type { Envelope } from "../types/index.ts";
import type { SqlExecutor } from "./types.ts";

const C = MESSAGE_LOG.col;
const T = MESSAGE_LOG.table;

// ON CONFLICT theo (channel, msg_id): dedupe Redis có TTL — webhook retry tới sau khi mark hết
// hạn vẫn không được nhân đôi row. DO NOTHING vì row cũ là bản chụp đúng của tin đó rồi.
const INSERT = `INSERT INTO ${T}
    (${C.channel}, ${C.msgId}, ${C.conversationId}, ${C.senderId}, ${C.senderName},
     ${C.isGroup}, ${C.addressedToAgent}, ${C.text}, ${C.imageUrl}, ${C.ts})
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (${C.channel}, ${C.msgId}) DO NOTHING`;

export class SqlMessageLog {
  constructor(private readonly exec: SqlExecutor) {}

  async append(envelope: Envelope): Promise<void> {
    await this.exec.query(INSERT, [
      envelope.channel,
      envelope.msgId,
      envelope.conversationId,
      envelope.senderId,
      envelope.senderName ?? null,
      envelope.isGroup,
      envelope.addressedToAgent,
      envelope.text,
      envelope.imageUrl ?? null,
      envelope.ts,
    ]);
  }
}
