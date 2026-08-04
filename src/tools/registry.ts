// registry.ts — ToolRegistry: bó Tool[] cho 1 request, expose schema cho LLM + tra tool theo tên.
// Dựng lại mỗi request (tool đã closure identity) — không phải singleton toàn app.

import type { LlmToolSchema } from "../llm/types.ts";
import type { Tool } from "./types.ts";

export class ToolRegistry {
  private readonly byName = new Map<string, Tool>();

  constructor(tools: readonly Tool[]) {
    for (const tool of tools) {
      if (this.byName.has(tool.name)) {
        throw new Error(`Tool trùng tên: ${tool.name}`);
      }
      this.byName.set(tool.name, tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  /** Schema đưa cho model (tier tool_use). */
  schemas(): LlmToolSchema[] {
    return [...this.byName.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }
}
