// /mcp — soát các server MCP (tool ngoài) đang được nối và tool nào đang bật.
//
// Đọc THẲNG registry đã dựng lúc boot, không gọi lại server: đây đúng là thứ agent đang cầm, nên
// người gõ thấy đúng thứ model thấy. Muốn số mới thì restart app (danh sách tool cố ý tĩnh cả
// vòng đời process — xem docs/architecture/10-mcp.md).
//
// CHỈ NHÂN VIÊN: đây là thông tin hạ tầng (tên hệ thống nội bộ nối vào agent), không phải việc
// của đại lý. URL và token KHÔNG bao giờ in ra — biết tên là đủ để soát.

import type { McpServerStatus } from "../../mcp/types.ts";
import { ActorRole, fail, ok, type FlashCommand, type FlashContext } from "../types.ts";

const mcp: FlashCommand = {
  name: "mcp",
  description: "Xem server MCP (tool ngoài) đang nối và tool đang bật: /mcp",
  allowedRoles: [ActorRole.NhanVien],

  handler(ctx: FlashContext) {
    if (ctx.mcp === undefined) {
      return Promise.resolve(fail("Chưa nối tầng MCP nên không có gì để soát."));
    }

    const servers = ctx.mcp.status();
    if (servers.length === 0) {
      return Promise.resolve(
        ok("Chưa khai server MCP nào (MCP_SERVERS trống) — agent chỉ chạy tool nội bộ."),
      );
    }

    const connected = servers.filter((server) => server.connected).length;
    const lines = [`MCP: ${connected}/${servers.length} server đang dùng được.`, ""];
    for (const server of servers) {
      lines.push(render(server));
    }

    return Promise.resolve(ok(lines.join("\n")));
  },
};

function render(server: McpServerStatus): string {
  if (!server.connected) {
    // Không nói lý do cụ thể ở đây: lý do nằm ở log boot, và in ra nhóm chat thì lộ hạ tầng.
    return `• ${server.name} — KHÔNG dùng được (xem log lúc khởi động).`;
  }

  const line = `• ${server.name} — ${server.tools.length} tool: ${server.tools.join(", ")}`;
  return server.missing.length === 0
    ? line
    : `${line}\n  (bật trong config nhưng server không có: ${server.missing.join(", ")})`;
}

export default mcp;
