// factory.ts — ChannelFactory: channel → Ingestor. Open/closed (giống FlashRegistry):
// thêm kênh = register 1 adapter, KHÔNG sửa file này.

import type { Ingestor } from "./ingestor.ts";

export class ChannelFactory {
  readonly #ingestors = new Map<string, Ingestor>();

  /** Trùng channel → throw (lỗi lập trình, lộ lúc khởi động). */
  register(ingestor: Ingestor): this {
    const key = ingestor.channel.toLowerCase();
    if (this.#ingestors.has(key)) {
      throw new Error(`Ingestor trùng channel: ${key}`);
    }
    this.#ingestors.set(key, ingestor);
    return this;
  }

  get(channel: string): Ingestor | undefined {
    return this.#ingestors.get(channel.toLowerCase());
  }
}
