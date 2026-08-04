// lock.ts — ORDER-LOCK theo conversationId (design §5 bước 5): 1 message/lúc/phòng, chống đua
// state group khi nhiều người gõ cùng lúc. Mỗi phòng 1 chuỗi promise nối tiếp; phòng khác song song.

export class ConversationLock {
  private readonly chains = new Map<string, Promise<void>>();

  /** Chạy task sau khi task trước CÙNG key xong. Key khác nhau chạy song song. */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const result = prev.then(task);
    // Chuỗi kế tiếp chờ result settle (nuốt cả lỗi để không đứt chuỗi phòng).
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, tail);
    void tail.finally(() => {
      // Dọn map khi mình là đuôi hiện tại (tránh rò bộ nhớ theo số phòng).
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return result;
  }
}
