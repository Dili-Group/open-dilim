// container.ts — "DI đơn giản": bó service đã dựng thành 1 struct type-safe (không any, không
// map<string,unknown> mất kiểu). Đây là service map mà worker/gateway nhận từ composition root.
//
// Thêm service (llm, broker thật, worker pool...) → thêm field vào Services + dựng ở index.ts.

import { type Server } from "bun";
import type { Config } from "../config.ts";
import type { IngestDeps } from "../message-ingest/index.ts";
import type { SkillRegistry } from "../skills/index.ts";
import type { FlashRegistry } from "../flash-command/index.ts";
import type { IdentityRepo, OpsPort } from "../flash-command/types.ts";
import type { JobAdmin, JobRepo } from "../scheduler/types.ts";
import type { LLMProvider } from "../llm/index.ts";
import type { McpRegistry } from "../mcp/index.ts";
import type { AgentRegistry } from "../agents/index.ts";
import type { Broadcaster, TypingFactory } from "../broadcast/index.ts";
import type { GroupCustomerLookup, IdentityResolver } from "../auth/index.ts";
import type {
  BrokerConsumer,
  HistoryReader,
  HistoryWriter,
  LatestTurnReader,
  UsageTracking,
} from "../worker/index.ts";
import type { ConversationCompactor, MemoryWriterLookup, SummaryReader } from "../state/index.ts";
import type { WorkflowDeps } from "../workflows/types.ts";
import type { WorkflowPort } from "../workflows/service.ts";
import type { WorkflowRegistry } from "../workflows/registry.ts";
import type {
  AnnounceApprovalPort,
  AnnouncePort,
  AnnouncementDeps,
} from "../announcements/types.ts";
import type { KbDigestService } from "../kb-digest/service.ts";
import type { KbDigestStore, KbReviewPort } from "../kb-digest/types.ts";
import type { ProactivePendingStore } from "../proactive/index.ts";

/** Mọi service dựng lúc boot, share cho các tầng downstream (worker/gateway). */
export interface Services {
  readonly config: Config;
  /** Port ingress (broker/history/dedupe). In-mem lúc dev, Redis lúc prod. */
  readonly ingestDeps: IngestDeps;
  /** Skill nạp từ defs/, dùng cho selector/worker. */
  readonly skills: SkillRegistry;
  /** Flash-command registry (stateless, share toàn app). */
  readonly flash: FlashRegistry;
  /** Ghi định danh cho flash command (user_binding/group_map/group_member). */
  readonly identityRepo: IdentityRepo;
  /** Port hệ vận hành cho flash command (verify token, tra đại lý). */
  readonly ops: OpsPort;
  /**
   * Job cron — MỘT instance, hai góc nhìn (như broker): `JobAdmin` cho flash command `/lich`
   * (thêm/sửa/tắt/xoá theo phòng), `JobRepo` cho poller (quét tới hạn + CAS claim).
   */
  readonly jobs: JobAdmin & JobRepo;
  /** LLM provider (chọn theo config). */
  readonly llm: LLMProvider;
  /** Root agent registry (worker resolve+run). */
  readonly agents: AgentRegistry;
  /** Egress (dev: console). */
  readonly broadcaster: Broadcaster;
  /** Nhịp "đang xử lý" theo channel (dev: console). Worker phát mỗi bước agent. */
  readonly typing: TypingFactory;
  /** Resolve senderId → vai (auth). */
  readonly identity: IdentityResolver;
  /** Tra phòng → khách sở hữu. Worker dựng MemoryScope từ đây (memory thuộc phòng). */
  readonly groupCustomer: GroupCustomerLookup;
  /** Đầu consume của broker — CÙNG instance với ingestDeps.broker. */
  readonly broker: BrokerConsumer;
  /**
   * Việc treo chờ phòng khác trả lời (§6). Hai mảnh vì hai người dùng khác nhau: tool của agent
   * đi qua `WorkflowService` (đã gói sẵn, nằm trong AgentDeps), còn poller cần cả `deps` lẫn
   * `registry` để tra def của từng việc đang treo.
   */
  readonly workflow: WorkflowPort;
  readonly workflowDeps: WorkflowDeps;
  readonly workflowRegistry: WorkflowRegistry;
  /**
   * Phát tin chung tới mọi nhóm đại lý. Ba mảnh vì ba người dùng khác nhau: tool của agent chỉ
   * XIN phát (`AnnouncePort`, đã nằm trong AgentDeps), flash command của người duyệt QUYẾT
   * (`AnnounceApprovalPort` — agent không cầm), poller cần `deps` để gửi thật.
   */
  readonly announce: AnnouncePort & AnnounceApprovalPort;
  readonly announceDeps: AnnouncementDeps;
  /**
   * Tool NGOÀI qua MCP: đã nối + đã chốt danh sách tool lúc boot. Agent nhận nó qua `AgentDeps`
   * (chỉ đọc/gọi); ở đây giữ bản đầy đủ vì shutdown phải đóng kết nối.
   * MCP_SERVERS rỗng → registry rỗng, không kết nối nào.
   */
  readonly mcp: McpRegistry;
  /** Đọc history — CÙNG instance với ingestDeps.history. */
  readonly historyReader: HistoryReader;
  /** Ghi history (flash reply) — CÙNG instance với historyReader/ingestDeps.history. */
  readonly historyWriter: HistoryWriter;
  /**
   * Đầu ĐỌC vạch tin mới nhất phòng — CÙNG instance với `ingestDeps.turns` (ingest nâng vạch,
   * pool soi vạch để gom tin gửi liên tiếp).
   */
  readonly turns: LatestTurnReader;
  /**
   * Đường ghi trí nhớ dài hạn THEO AGENT (distill theo lô → embed → pgvector) — mỗi agent chưng
   * cất bằng `memorySpec` của nó. undefined khi thiếu GEMINI_API_KEY → hệ chạy bằng ngắn hạn,
   * không chặn boot.
   */
  readonly memoryWriters?: MemoryWriterLookup;
  /** Nén hội thoại ngắn hạn theo phòng + cổng đọc bản tóm cho bước STATE. */
  readonly compactor: ConversationCompactor;
  readonly summaries: SummaryReader;
  /** Đo chi phí LLM theo phòng + chặn phòng vượt trần ngày (usage/). */
  readonly usage: UsageTracking;
  /** Digest cuối ngày + kiểm duyệt knowledge base (kb-digest/): store + pipeline + cửa duyệt. */
  readonly kbDigestStore: KbDigestStore;
  readonly kbDigest: KbDigestService;
  readonly kbReview: KbReviewPort;
  /**
   * Hàng chờ phễu proactive (proactive/): ingest đặt lịch, poller nhặt. undefined = phễu tắt
   * toàn cục (không agent nào khai spec, hay muốn tắt hẳn) → không dựng poller.
   */
  readonly proactivePending?: ProactivePendingStore;
}

/** Hệ thống ĐANG CHẠY: service + HTTP server + hook shutdown sạch. */
export interface RunningSystem {
  readonly services: Services;
  readonly server: Server<undefined>;
  /** Dừng gateway + đóng pool DB. Idempotent-safe do caller gọi 1 lần khi nhận signal. */
  stop(): Promise<void>;
}
