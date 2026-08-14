// registry.ts — parse + dispatch flash command. Open/closed: thêm lệnh không sửa file này.
//
// Luồng: text → parseCommand → resolve tên → guard vai → handler. Mọi lỗi (không phải lệnh,
// tên lạ, thiếu quyền, handler ném) trả về structured, KHÔNG crash caller (cô lập per-message).

import { foldVietnamese } from "./normalize.ts";
import {
  fail,
  type AnnounceApprovalPort,
  type FlashCommand,
  type FlashContext,
  type FlashResult,
  type Identity,
  type JobAdmin,
  type Mention,
  type OpsPort,
  type IdentityRepo,
} from "./types.ts";
import type { UsageTracking } from "../usage/types.ts";
import type { McpStatusPort } from "../mcp/types.ts";
import type { KbReviewPort } from "../kb-digest/types.ts";

const COMMAND_PREFIX = "/";

/** Phần đã tách khỏi text: tên lệnh (không `/`, viết thường) + args. */
export type ParsedCommand = { name: string; args: string[] };

/**
 * Tách text thành lệnh. null = KHÔNG phải flash command → caller cho agent (LLM) xử lý.
 * Chỉ nhận diện, không validate tên tồn tại (việc của dispatch).
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(COMMAND_PREFIX)) return null;

  const tokens = trimmed
    .slice(COMMAND_PREFIX.length)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const name = tokens[0];
  // "/" trơ hoặc "/   " → không có tên → không coi là lệnh.
  if (name === undefined) return null;

  // Bỏ dấu ngay tại parse: `/lịch` và `/lich` là MỘT lệnh (xem normalize.ts). args giữ nguyên dấu.
  return { name: foldVietnamese(name), args: tokens.slice(1) };
}

/**
 * Dữ liệu ngoài `args` (đã có trong ParsedCommand) mà dispatch cần để dựng FlashContext.
 * Ingest cấp phần này sau khi AUTH resolve identity.
 */
export type DispatchInput = {
  readonly identity: Identity;
  readonly channel: string;
  readonly groupId: string | undefined;
  /** Khoá phòng của lượt (`Envelope.conversationId`) — lệnh tra mức dùng gom theo đây. */
  readonly conversationId: string;
  readonly mentions: readonly Mention[];
  readonly repo: IdentityRepo;
  readonly ops: OpsPort;
  readonly jobs: JobAdmin;
  readonly announce?: AnnounceApprovalPort;
  /** Root agent của phòng — worker resolve theo channel, lệnh tra trần chi phí dùng tới. */
  readonly agentType: string;
  readonly usage?: UsageTracking;
  /** Soát server MCP đang nối (`/mcp`). undefined = chưa nối tầng MCP. */
  readonly mcp?: McpStatusPort;
  /** Kiểm duyệt knowledge base (`/kiemduyet-kb`, `/duyet-kb`…). undefined = chưa wiring. */
  readonly kb?: KbReviewPort;
};

export class FlashRegistry {
  readonly #commands = new Map<string, FlashCommand>();

  /** Đăng ký 1 lệnh. Trùng tên → throw (lỗi lập trình, phát hiện lúc khởi động). */
  register(command: FlashCommand): this {
    const key = foldVietnamese(command.name);
    if (this.#commands.has(key)) {
      throw new Error(`Flash command trùng tên: ${key}`);
    }
    this.#commands.set(key, command);
    return this;
  }

  get(name: string): FlashCommand | undefined {
    return this.#commands.get(foldVietnamese(name));
  }

  /** Liệt kê lệnh (help / introspection). */
  list(): readonly FlashCommand[] {
    return [...this.#commands.values()];
  }

  /**
   * Chạy text như flash command.
   * - null  → text KHÔNG phải lệnh (để agent xử lý).
   * - FlashResult → đã xử lý (kể cả lỗi tên/quyền/handler — luôn có reply).
   */
  async dispatch(
    text: string,
    input: DispatchInput,
  ): Promise<FlashResult | null> {
    const parsed = parseCommand(text);
    if (parsed === null) return null;

    const command = this.get(parsed.name);
    if (command === undefined) {
      return fail(`Lệnh không tồn tại: /${parsed.name}`);
    }

    if (
      command.allowedRoles &&
      !command.allowedRoles.includes(input.identity.role)
    ) {
      return fail(`Không đủ quyền chạy /${parsed.name}`);
    }

    const ctx: FlashContext = {
      identity: input.identity,
      channel: input.channel,
      groupId: input.groupId,
      conversationId: input.conversationId,
      args: parsed.args,
      mentions: input.mentions,
      repo: input.repo,
      ops: input.ops,
      jobs: input.jobs,
      announce: input.announce,
      agentType: input.agentType,
      usage: input.usage,
      mcp: input.mcp,
      kb: input.kb,
    };

    try {
      return await command.handler(ctx);
    } catch (err) {
      // Cô lập: 1 lệnh lỗi không được làm sập worker. Log gốc, trả lỗi chung cho người dùng.
      console.error(`Flash command /${parsed.name} lỗi:`, err);
      return fail(`Lỗi xử lý lệnh /${parsed.name}. Thử lại sau.`);
    }
  }
}
