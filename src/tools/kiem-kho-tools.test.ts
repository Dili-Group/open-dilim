// Test kiểm kho trên chữ chép THẬT của ảnh bảng kiểm kho ngày 22/10/2026 (34 dòng). Ba thứ chốt:
//   1. Bộ kiểm chéo nhận đúng bảng thật — kể cả dòng Cộng bỏ sót dòng không mã — và chặn mọi kiểu
//      đọc hỏng (lệch một chữ số, sót dòng, ô mờ, sai ngày, phá công thức ca tối).
//   2. Tool chỉ ghi khi bảng qua kiểm; lỗi hệ thống tách "chưa ghi" với "không rõ đã ghi chưa".
//   3. Phòng báo tồn bắt đúng tin "Kho gửi số tồn đầu/cuối ngày" và chỉ phòng đó đi agent kiểm kho.

import { describe, expect, test } from "bun:test";
import { dedicatedRoomOf, kiemKhoRoom, matchesTemplate } from "../agents/dedicated-rooms.ts";
import { resolveAgentType } from "../agents/router.ts";
import { AgentType } from "../agents/types.ts";
import type { Identity } from "../flash-command/types.ts";
import { AgentApiClient, AgentApiError, type FetchInit } from "../operational/agent-api.ts";
import { AgentApiInventoryCountPort } from "../operational/inventory-count-api.ts";
import {
  CountShift,
  type InventoryCountPort,
  type StockCountRequest,
  type StockCountResult,
} from "../operational/types.ts";
import { buildSkillRegistry } from "../skills/index.ts";
import { ImageReadError, type VisionPort, type VisionReadRequest } from "../vision/types.ts";
import { checkSheet, parseSheet, type ParsedSheet } from "./impl/kiem-kho/bang-kiem.ts";
import { buildStockCountTool } from "./impl/kiem-kho/ghi-ton-kho.ts";
import type { ToolContext } from "./types.ts";

/** Đúng khung THẤY/SUY LUẬN con đọc ảnh trả về (vision/prompt.ts), số liệu chép từ ảnh kho gửi. */
const REAL_SHEET = `THẤY:
- Ngày: 22
- 1: AFCDAUGOI|-|||-|-
- 2: AFCDAUXA|4|||-|4
- 3: AFCDUONGTOC|4|||-|4
- 4: AFCGIAMMO|406|||45|361
- 5: AFCRICH|261|||55|206
- 6: BINHGN|454|||10|444
- 7: CLGBH|11|||6|5
- 8: DHA330|91|||19|72
- 9: FCDEX150|23|||-|23
- 10: FCDKEN|18|||-|18
- 11: FCDNAWAPL|29|||-|29
- 12: GDG180|17|||-|17
- 13: GDG330|6|||4|2
- 14: GELNMN|1|||-|1
- 15: GLU|70|||4|66
- 16: HAUNN|6|||2|4
- 17: INSUNA|32|||20|12
- 18: KCN|14|||-|14
- 19: MXNBH|884|||106|778
- 20: NMN27|7|||-|7
- 21: NMTNB|4.347|||64|4.283
- 22: NTNC120|277|||35|242
- 23: PEELINGGEL|-|||-|-
- 24: RAYDEL|51|||9|42
- 25: SCMNB|605|||90|515
- 26: TCC|231|||45|186
- 27: NMNSOAP|1|||-|1
- 28: BOPHOI|27|||-|27
- 29: GOUT|30|||8|22
- 30: OMEGA|-|||-|-
- 31: VTDHA|17|||7|10
- 32: TUIMYPHAM|388|||1|387
- 33: |100|||100|-
- 34: AMDLM|600|||13|587
- Cộng: 8.912|-|-|543|8.369
SUY LUẬN: không cần`;

function mutate(from: string, to: string): ParsedSheet {
  return parseSheet(REAL_SHEET.replace(from, to));
}

function problemsOf(sheet: ParsedSheet, shift: CountShift, day = 22): string {
  const check = checkSheet(sheet, shift, day);
  return check.ok ? "" : check.problems.join("\n");
}

describe("bảng kiểm kho: đọc + kiểm chéo", () => {
  test("bảng thật, ca đầu ngày: 33 mã, bỏ dòng 33 không mã, Cộng 8.912", () => {
    const sheet = parseSheet(REAL_SHEET);
    const check = checkSheet(sheet, CountShift.DauNgay, 22);

    expect(sheet.day).toBe(22);
    expect(sheet.rows).toHaveLength(34);
    if (!check.ok) throw new Error(check.problems.join("; "));
    expect(check.lines).toHaveLength(33);
    expect(check.lines).toContainEqual({ sku: "NMTNB", quantity: 4347 });
    expect(check.lines).toContainEqual({ sku: "AFCDAUGOI", quantity: 0 });
    // Dòng Cộng của Excel bỏ sót dòng chèn sau (Dù gấp 3 khúc) — vẫn phải nhận.
    expect(check.skipped).toEqual([{ stt: 33, quantity: 100 }]);
    expect(check.total).toBe(8912);
  });

  test("bảng thật, ca cuối ngày: lấy cột KK Chiều, công thức từng dòng khớp", () => {
    const check = checkSheet(parseSheet(REAL_SHEET), CountShift.CuoiNgay, 22);

    if (!check.ok) throw new Error(check.problems.join("; "));
    expect(check.lines).toContainEqual({ sku: "AFCRICH", quantity: 206 });
    expect(check.lines).toContainEqual({ sku: "NMTNB", quantity: 4283 });
    expect(check.skipped).toEqual([]);
    expect(check.total).toBe(8369);
  });

  test("đọc lệch một chữ số → lệch dòng Cộng, không ghi", () => {
    const problems = problemsOf(mutate("NMTNB|4.347", "NMTNB|4.341"), CountShift.DauNgay);

    expect(problems).toContain("cột KK Sáng");
    expect(problems).toContain("dòng Cộng ghi 8912");
  });

  test("ca cuối ngày: số KK Chiều phá công thức → chỉ đúng dòng đó", () => {
    const sheet = mutate("AFCRICH|261|||55|206", "AFCRICH|261|||55|208");
    const problems = problemsOf(
      { ...sheet, total: [8912, 0, 0, 543, 8371] },
      CountShift.CuoiNgay,
    );

    expect(problems).toContain("dòng 5 (AFCRICH): KK Sáng + Hoàn + Nhập − Xuất không bằng KK Chiều");
    expect(problems).not.toContain("dòng Cộng ghi");
  });

  test("con đọc ảnh sót một dòng → báo thiếu STT", () => {
    const problems = problemsOf(mutate("- 7: CLGBH|11|||6|5\n", ""), CountShift.CuoiNgay);

    expect(problems).toContain("thiếu dòng STT 7");
  });

  test("ô mờ [?] → báo đúng dòng, không đoán số", () => {
    const problems = problemsOf(mutate("AFCGIAMMO|406", "AFCGIAMMO|406 [?]"), CountShift.DauNgay);

    expect(problems).toContain("dòng 4 (AFCGIAMMO): có ô số không đọc rõ");
  });

  test("ảnh là cột ngày khác ngày đang ghi → chặn", () => {
    expect(problemsOf(parseSheet(REAL_SHEET), CountShift.DauNgay, 23)).toContain(
      "ảnh là cột ngày 22, không phải ngày 23",
    );
  });

  test("ảnh cắt mất dòng Cộng → không có gì để đối chiếu, chặn", () => {
    const problems = problemsOf(mutate("- Cộng: 8.912|-|-|543|8.369", ""), CountShift.DauNgay);

    expect(problems).toContain("không đọc được số dòng Cộng");
  });

  test("không đọc ra dòng nào → chặn", () => {
    expect(problemsOf(parseSheet("THẤY:\n- Loại ảnh: ảnh chụp sản phẩm"), CountShift.DauNgay)).toContain(
      "không đọc ra dòng nào",
    );
  });
});

const STAFF: Identity = { role: "nhan_vien", senderId: "u1", userId: "42" };
const DEALER: Identity = { role: "dai_ly", senderId: "u2", customerId: "dealer-9" };
const URL_OK = "https://photo-stal-21.zdn.vn/gr/bang-kiem.jpg";
const skills = await buildSkillRegistry();

class FakeVision implements VisionPort {
  readonly calls: VisionReadRequest[] = [];
  constructor(private readonly outcome: string | Error = REAL_SHEET) {}
  read(req: VisionReadRequest): Promise<string> {
    this.calls.push(req);
    return this.outcome instanceof Error ? Promise.reject(this.outcome) : Promise.resolve(this.outcome);
  }
}

const RECORDED: StockCountResult = {
  saved: 31,
  unknownSkus: ["BINHGN", "AMDLM"],
  submittedNow: true,
  compared: true,
  countedTotal: 7858,
  misaTotal: 7857,
  diffs: [{ sku: "AFCRICH", name: "Rich Coenzyme Q10", counted: 261, misa: 260, diff: 1 }],
};

class FakeInventoryCount implements InventoryCountPort {
  readonly calls: StockCountRequest[] = [];
  constructor(private readonly outcome: StockCountResult | Error = RECORDED) {}
  record(r: StockCountRequest): Promise<StockCountResult> {
    this.calls.push(r);
    return this.outcome instanceof Error ? Promise.reject(this.outcome) : Promise.resolve(this.outcome);
  }
}

function contextOf(
  identity: Identity,
  ports: { vision?: VisionPort; inventoryCount?: InventoryCountPort },
): ToolContext {
  return { skills, identity, ...ports };
}

describe("ghi_ton_kho", () => {
  test("bảng thật ca đầu ngày → ghi 33 mã dưới tên nhân viên, báo lệch + mã không ghi", async () => {
    const vision = new FakeVision();
    const counts = new FakeInventoryCount();
    const result = await buildStockCountTool(contextOf(STAFF, { vision, inventoryCount: counts })).run({
      url: URL_OK,
      ca: "dau_ngay",
      ngay: "22/10/2026",
    });

    expect(result.isError).toBeUndefined();
    expect(vision.calls[0]?.question).toContain("ngày 22");
    expect(counts.calls[0]?.staffId).toBe("42");
    expect(counts.calls[0]?.date).toBe("2026-10-22");
    expect(counts.calls[0]?.shift).toBe(CountShift.DauNgay);
    expect(counts.calls[0]?.lines).toHaveLength(33);
    expect(result.content).toContain("dòng Cộng trên bảng 8.912");
    expect(result.content).toContain("AFCRICH Rich Coenzyme Q10: đếm 261, MISA 260 (+1)");
    expect(result.content).toContain("BINHGN, AMDLM");
    expect(result.content).toContain("STT 33 (100)");
  });

  test("bảng đọc lệch → KHÔNG gọi hệ thống, báo đúng điểm lệch", async () => {
    const counts = new FakeInventoryCount();
    const vision = new FakeVision(REAL_SHEET.replace("NMTNB|4.347", "NMTNB|4.341"));
    const result = await buildStockCountTool(contextOf(STAFF, { vision, inventoryCount: counts })).run({
      url: URL_OK,
      ca: "dau_ngay",
      ngay: "2026-10-22",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CHƯA GHI GÌ");
    expect(counts.calls).toHaveLength(0);
  });

  test("người gửi chưa gắn tài khoản nhân viên → chặn trước khi đọc ảnh", async () => {
    const vision = new FakeVision();
    const result = await buildStockCountTool(
      contextOf(DEALER, { vision, inventoryCount: new FakeInventoryCount() }),
    ).run({ url: URL_OK, ca: "cuoi_ngay" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("/ketnoi-hethong");
    expect(vision.calls).toHaveLength(0);
  });

  test("chưa nối cổng → nói rõ chưa ghi được", async () => {
    const result = await buildStockCountTool(contextOf(STAFF, {})).run({ url: URL_OK, ca: "dau_ngay" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("CHƯA ghi");
  });

  test("ca lạ → isError, không đọc ảnh", async () => {
    const vision = new FakeVision();
    const result = await buildStockCountTool(
      contextOf(STAFF, { vision, inventoryCount: new FakeInventoryCount() }),
    ).run({ url: URL_OK, ca: "trua" });

    expect(result.isError).toBe(true);
    expect(vision.calls).toHaveLength(0);
  });

  test("ảnh tải không được → lời của cổng ảnh đi thẳng cho model", async () => {
    const vision = new FakeVision(new ImageReadError("Link ảnh trả lỗi 404"));
    const result = await buildStockCountTool(
      contextOf(STAFF, { vision, inventoryCount: new FakeInventoryCount() }),
    ).run({ url: URL_OK, ca: "dau_ngay", ngay: "22/10/2026" });

    expect(result).toEqual({ content: "Link ảnh trả lỗi 404", isError: true });
  });

  test("hệ thống từ chối (4xx) → chắc chắn CHƯA ghi; sập (5xx/mạng) → KHÔNG RÕ đã ghi chưa", async () => {
    const run = (err: AgentApiError) =>
      buildStockCountTool(
        contextOf(STAFF, { vision: new FakeVision(), inventoryCount: new FakeInventoryCount(err) }),
      ).run({ url: URL_OK, ca: "cuoi_ngay", ngay: "22/10/2026" });

    const rejected = await run(new AgentApiError("Có nhiều chi nhánh kiểm kho", 422, "HTTP_422", "/x"));
    const down = await run(new AgentApiError("timeout", 0, "AGENT_API_TRANSPORT", "/x"));

    expect(rejected.content).toContain("Hệ thống từ chối, CHƯA ghi");
    expect(down.content).toContain("KHÔNG RÕ");
  });
});

describe("AgentApiInventoryCountPort", () => {
  test("gửi đúng body backend chờ, đọc số NUMERIC dạng chuỗi về number", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const client = new AgentApiClient({
      baseUrl: "https://api.test/api",
      serviceToken: "token",
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({
          ok: true,
          status: 201,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                success: true,
                data: {
                  saved: 2,
                  unknown_skus: ["AMDLM"],
                  submitted_now: true,
                  compared: true,
                  summary: { counted_total: "4608.0000", misa_total: "4607.0000" },
                  diffs: [
                    { sku: "AFCRICH", name: "Rich", counted_quantity: "261.0000", misa_quantity: "260.0000", diff: "1.0000" },
                  ],
                },
              }),
            ),
        });
      },
    });

    const result = await new AgentApiInventoryCountPort(client).record({
      staffId: "42",
      date: "2026-10-22",
      shift: CountShift.CuoiNgay,
      lines: [{ sku: "AFCRICH", countedQuantity: 261 }],
    });

    expect(calls[0]?.url).toBe("https://api.test/api/agent/internal/inventory-counts");
    expect(calls[0]?.init.headers["x-staff-id"]).toBe("42");
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({
      snapshot_date: "2026-10-22",
      shift: 1,
      lines: [{ sku: "AFCRICH", counted_quantity: 261 }],
    });
    expect(result.unknownSkus).toEqual(["AMDLM"]);
    expect(result.countedTotal).toBe(4608);
    expect(result.diffs).toEqual([{ sku: "AFCRICH", name: "Rich", counted: 261, misa: 260, diff: 1 }]);
  });
});

describe("phòng báo tồn", () => {
  const room = kiemKhoRoom("g-kiemkho");

  test("bắt tin kho gửi bảng, kể cả gõ không dấu / có dòng chào phía trên", () => {
    if (room === undefined) throw new Error("phải dựng được phòng khi có id nhóm");
    for (const text of [
      "Kho gửi số tồn đầu ngày 23/10",
      "kho gửi số tồn cuối ngày",
      "Chào cả nhà\nKho gửi số tồn cuối ngày 22/10 ạ",
      "Kho gui so ton dau ngay",
      "KHO GỬI SỐ TỒN ĐẦU NGÀY",
    ]) {
      expect(matchesTemplate(room, text)).toBe(true);
    }
    expect(matchesTemplate(room, "tồn kho mã NMTNB còn bao nhiêu")).toBe(false);
  });

  test("chỉ nhóm báo tồn trên zalo-kho đi agent kiểm kho; nhóm kho khác giữ agent Warehouse", () => {
    const rooms = room === undefined ? [] : [room];

    expect(dedicatedRoomOf(rooms, "zalo-kho", "g-kiemkho")?.agentType).toBe(AgentType.InventoryCount);
    expect(resolveAgentType("zalo-kho", "g-kiemkho", rooms)).toBe(AgentType.InventoryCount);
    expect(resolveAgentType("zalo-kho", "g-hang-hoan", rooms)).toBe(AgentType.Warehouse);
  });

  test("chưa khai env → không có phòng, agent kiểm kho tắt", () => {
    expect(kiemKhoRoom(undefined)).toBeUndefined();
    expect(kiemKhoRoom("  ")).toBeUndefined();
  });
});
