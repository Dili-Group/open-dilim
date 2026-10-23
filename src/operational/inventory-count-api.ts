// inventory-count-api.ts — InventoryCountPort chạy thật trên `POST /agent/internal/inventory-counts`.
//
// Đi qua `postAsStaff`: không đại lý, không retry (lệnh ghi bắn lại là ghi lại). Nhóm
// `/agent/internal/*` BẮT BUỘC `x-staff-id` — tool chặn trước khi tới đây nếu người gửi chưa gắn
// tài khoản nhân viên.
//
// Cùng luật boundary với internal-api.ts: JSON là `unknown`, field thiếu/sai kiểu → undefined, KHÔNG
// bịa mặc định (thiếu số lệch thì tool in "không rõ", không in 0).

import {
  AgentApiError,
  AgentApiErrorCode,
  readEnvelopeData,
  type AgentApiClient,
} from "./agent-api.ts";
import { asRecord, isPresent, readBoolean, readList, readNumber, readString } from "./read.ts";
import type {
  InventoryCountPort,
  StockCountDiff,
  StockCountRequest,
  StockCountResult,
} from "./types.ts";

const RECORD_PATH = "/agent/internal/inventory-counts";

export class AgentApiInventoryCountPort implements InventoryCountPort {
  constructor(private readonly api: AgentApiClient) {}

  async record(r: StockCountRequest): Promise<StockCountResult> {
    const body = await this.api.postAsStaff(RECORD_PATH, {
      staffId: r.staffId,
      body: {
        snapshot_date: r.date,
        shift: r.shift,
        lines: r.lines.map((line) => ({ sku: line.sku, counted_quantity: line.countedQuantity })),
      },
      signal: r.signal,
    });

    const data = asRecord(readEnvelopeData(body, RECORD_PATH));
    if (data === undefined) {
      throw new AgentApiError(
        `POST ${RECORD_PATH} trả "data" không phải object`,
        200,
        AgentApiErrorCode.InvalidResponse,
        RECORD_PATH,
      );
    }
    const summary = asRecord(data["summary"]) ?? {};
    return {
      saved: readNumber(data, "saved"),
      unknownSkus: readList(data, "unknown_skus").filter(isNonEmptyString).map((sku) => sku.trim()),
      submittedNow: readBoolean(data, "submitted_now"),
      compared: readBoolean(data, "compared"),
      countedTotal: readQuantity(summary, "counted_total"),
      misaTotal: readQuantity(summary, "misa_total"),
      diffs: readList(data, "diffs").map(readDiff).filter(isPresent),
    };
  }
}

/** Dòng lệch không có mã thì không báo lại được cho kho → bỏ. */
function readDiff(value: unknown): StockCountDiff | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const sku = readString(record, "sku");
  if (sku === undefined) return undefined;
  return {
    sku,
    name: readString(record, "name"),
    counted: readQuantity(record, "counted_quantity"),
    misa: readQuantity(record, "misa_quantity"),
    diff: readQuantity(record, "diff"),
  };
}

/** NUMERIC của Postgres về dạng chuỗi ("261.0000", "-3.0000") → number. Rác → undefined. */
function readQuantity(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
