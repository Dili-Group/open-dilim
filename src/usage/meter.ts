// meter.ts — bộ cộng dồn token của MỘT lượt. Một lượt agent gọi LLM nhiều lần (mỗi vòng
// LLM⇄tools một lần, tới `agentMaxIterations`), cộng thêm lượt định tuyến sub-agent. Chỉ lấy
// usage của lần gọi cuối là hụt gần hết.
//
// Cố tình là object KHẢ BIẾN chuyền xuống, không phải giá trị trả về: `runAgentLoop` trả text
// trả lời, đổi kiểu trả về của nó sẽ lan qua RootAgent.run → AgentResult → mọi caller, chỉ để
// mang theo một con số phụ.

import { EMPTY_USAGE, type LlmUsage } from "../llm/types.ts";

export class UsageMeter {
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private calls = 0;

  add(usage: LlmUsage): void {
    this.input += usage.input;
    this.output += usage.output;
    this.cacheRead += usage.cacheRead;
    this.cacheWrite += usage.cacheWrite;
    this.calls += 1;
  }

  total(): LlmUsage {
    return {
      input: this.input,
      output: this.output,
      cacheRead: this.cacheRead,
      cacheWrite: this.cacheWrite,
    };
  }

  /** Số lần gọi model đã gộp. 0 = lượt không chạm LLM (flash command, bị chặn) → khỏi ghi sổ. */
  callCount(): number {
    return this.calls;
  }

  isEmpty(): boolean {
    return this.calls === 0;
  }
}

/** Gộp nhiều usage thành một — dùng ở test và chỗ cộng ngoài loop. */
export function sumUsage(items: readonly LlmUsage[]): LlmUsage {
  return items.reduce(
    (acc, u) => ({
      input: acc.input + u.input,
      output: acc.output + u.output,
      cacheRead: acc.cacheRead + u.cacheRead,
      cacheWrite: acc.cacheWrite + u.cacheWrite,
    }),
    EMPTY_USAGE,
  );
}
