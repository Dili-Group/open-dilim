// probe.ts — SOI tầng 2 của phễu proactive: gửi một câu vào Jev với ĐÚNG bộ câu hỏi thật rồi in
// RAW response, trước khi narrow. Dùng khi log `[proactive] judge hỏng (200) → ... trả score lạ`:
// lỗi đó nghĩa là model trả shape khác thứ adapter chờ, mà adapter thì không in shape ra.
//
// Chạy:
//   bun run src/judge/probe.ts "giúp a đơn này e" "hi em"
//   docker compose -f docker-compose.prod.yml --env-file .env.prod exec app \
//     bun run src/judge/probe.ts "giúp a đi đơn với"
//
// Gọi THẲNG API, không qua JevJudge: JevJudge ném ngay khi shape lạ, đúng thứ đang cần nhìn.
// Script dev, không nằm trên đường chạy của app.

import { CONFIG } from "../config.ts";
import { dealerProfile } from "../agents/roots/dealer.ts";
import { PROACTIVE_QUESTIONS, buildJudgeState, quyetDinh } from "../proactive/judge.ts";
import type { ProactiveAnswers } from "../proactive/judge.ts";

const PROBE_TIMEOUT_MS = 15_000;

function usage(): never {
  console.error('dùng: bun run src/judge/probe.ts "câu cần chấm" ["câu nữa" ...]');
  process.exit(2);
}

const texts = Bun.argv.slice(2).filter((t) => t.trim() !== "");
if (texts.length === 0) usage();

const apiKey = CONFIG.jev.apiKey;
if (apiKey === undefined) {
  console.error("thiếu JEV_API_KEY — probe không chạy được.");
  process.exit(2);
}

const spec = dealerProfile.proactive?.judge;
if (spec === undefined) {
  console.error("dealerProfile không khai phễu proactive — không có spec để chấm.");
  process.exit(2);
}

for (const text of texts) {
  const state = buildJudgeState({
    question: {
      channel: "zalo",
      conversationId: "probe",
      senderId: "probe",
      senderName: "một đại lý",
      msgId: "probe",
      text,
      ts: Date.now(),
    },
    recent: [],
    spec,
  });

  const started = Date.now();
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: CONFIG.jev.model, state, questions: PROACTIVE_QUESTIONS }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const body = await response.text();

  console.log(`\n${"═".repeat(78)}\n» ${text}\n${"═".repeat(78)}`);
  console.log(`HTTP ${response.status} · ${Date.now() - started}ms · model=${CONFIG.jev.model}`);
  console.log("── state gửi đi ──");
  console.log(JSON.stringify(state, null, 2));
  console.log("── response THÔ ──");
  console.log(body);

  if (!response.ok) continue;

  // Narrow lỏng: probe chỉ báo cáo, không phán. Sai kiểu ở đây là DỮ LIỆU cần nhìn, không phải lỗi.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    console.log("→ response không phải JSON.");
    continue;
  }
  const answers = isRecord(parsed) ? parsed.answers : undefined;
  if (!isRecord(answers)) {
    console.log("→ response thiếu `answers`.");
    continue;
  }

  console.log("── từng câu: KIỂU thật vs kiểu adapter chờ (đều là noul → số 0-1) ──");
  for (const id of Object.keys(PROACTIVE_QUESTIONS)) {
    const answer = answers[id];
    const value = isRecord(answer) ? answer.noul : undefined;
    const keys = isRecord(answer) ? Object.keys(answer).join(", ") : "—";
    console.log(
      `  ${id.padEnd(16)} noul=${JSON.stringify(value)} (${typeof value}) · field có: ${keys}`,
    );
  }

  // Chỉ chấm được khi shape đúng như adapter chờ — không thì bỏ qua, raw ở trên đã đủ để đọc.
  if (looksLikeAnswers(answers)) {
    console.log("── phán quyết theo ngưỡng hiện tại ──");
    console.log(JSON.stringify(quyetDinh(answers, spec), null, 2));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Đủ shape để `quyetDinh` đọc được hay chưa. Kiểm TỪNG field mà luật thật sự chạm tới — probe
 * không được ép kiểu bừa rồi để luật đọc `undefined` và trả ra phán quyết bịa.
 */
function looksLikeAnswers(answers: Record<string, unknown>): answers is ProactiveAnswers {
  for (const id of Object.keys(PROACTIVE_QUESTIONS)) {
    const answer = answers[id];
    if (!isRecord(answer)) return false;
    if (typeof answer.noul !== "number") return false;
    if (typeof answer.confidence !== "number") return false;
  }
  return true;
}
