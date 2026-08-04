// index.ts — ENTRYPOINT process. Gọi start() (composition root) → gateway chạy. Wire signal
// shutdown để đóng server + pool DB sạch. Không chứa logic wiring (đó là việc của bootstrap/).

import { start } from "./bootstrap/index.ts";

const system = await start();
console.log(`[dilim-agent] gateway nghe cổng :${system.services.config.port}`);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return; // signal lặp (SIGINT ×2) → bỏ qua lần sau
  shuttingDown = true;
  console.log(`[dilim-agent] nhận ${signal} → shutdown`);
  await system.stop();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
