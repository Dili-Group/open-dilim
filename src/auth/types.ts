// types.ts — port resolve danh tính. Vai LUÔN resolve từ senderId server-side TRƯỚC khi chạy
// agent (design §5 bước 6, §auth). LLM/client KHÔNG được tự set identity → chống bypass.

import type { Identity } from "../flash-command/types.ts";

export interface ResolveInput {
  readonly channel: string;
  readonly senderId: string;
  /** undefined khi chat trực tiếp (không phải group). */
  readonly groupId?: string;
}

export interface IdentityResolver {
  resolve(input: ResolveInput): Promise<Identity>;
}
