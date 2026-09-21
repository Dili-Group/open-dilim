// index.ts — điểm lắp tầng judge. Port + kiểu ở types.ts, adapter Jev ở jev.ts.

export {
  JudgeError,
  choice,
  noul,
  score,
  type AnswerOf,
  type AnswersOf,
  type ChoiceAnswer,
  type ChoiceDef,
  type JudgeAsk,
  type JudgePort,
  type NoulAnswer,
  type NoulDef,
  type QuestionDef,
  type QuestionSet,
  type ScoreAnswer,
  type ScoreDef,
} from "./types.ts";
export { JevJudge, type JevOptions, type JudgeFetchLike } from "./jev.ts";
