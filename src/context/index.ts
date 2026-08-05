// index.ts — bề mặt công khai tầng context. Chỉ re-export: module này không dựng gì (deps do
// composition root inject), nên không có builder ở đây.

export { assembleTurnContext } from "./assembler.ts";
export { renderMemoryBlock } from "./memory-block.ts";
export type { ContextSources, TurnContext, TurnInput } from "./types.ts";
