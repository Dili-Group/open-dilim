// whoami.ts — tool READ (auto) demo: trả về danh tính người đang hỏi. Không tham số, không I/O.
// Minh hoạ act-as: identity đến TỪ CLOSURE (buildWhoamiTool(identity)), KHÔNG từ input LLM sinh.

import type { Identity } from "../../flash-command/types.ts";
import type { Tool } from "../types.ts";

export function buildWhoamiTool(identity: Identity): Tool {
  return {
    name: "whoami",
    description: "Cho biết bạn đang thao tác với tư cách nào (nhân viên / đại lý / khách).",
    inputSchema: { type: "object", properties: {}, required: [] },
    run(): Promise<{ content: string }> {
      return Promise.resolve({ content: describe(identity) });
    },
  };
}

function describe(identity: Identity): string {
  switch (identity.role) {
    case "nhan_vien":
      return identity.fullName === undefined
        ? `Nhân viên (userId=${identity.userId}).`
        : `Nhân viên ${identity.fullName} (userId=${identity.userId}).`;
    case "dai_ly":
      return `Đại lý (customerId=${identity.customerId}).`;
    case "guest":
      return "Khách — chưa định danh trong hệ thống.";
  }
}
