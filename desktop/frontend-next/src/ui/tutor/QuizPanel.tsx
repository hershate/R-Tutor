import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { reason } from "../../i18n/kernel";
import type { AgentPort } from "../../port/port";
import type { TutorQuizItem } from "../../port/tutor";

// The quiz panel: a quiz run as a tab. Choice questions are
// judged by the server; fill/short/essay reveal a reference answer for
// self-assessment. When every choice is judged, per-node accuracy is written
// back as progress — score ≥ 0.8 marks the node done.
interface Props {
  port: AgentPort;
  pid: string;
  onError: (message: string) => void;
}

type Verdict = { correct: boolean | null; answer?: string; explanation?: string };

export function QuizPanel({ port, pid, onError }: Props) {
  const [items, setItems] = useState<TutorQuizItem[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    port.tutorQuizzes(pid).then((set) => setItems(set.quizzes)).catch(() => setItems([]));
  }, [port, pid]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const set = await port.tutorQuizGenerate(pid, items !== null && items.length > 0);
      setItems(set.quizzes);
      setPicked({});
      setVerdicts({});
      setRevealed({});
    } catch (e) {
      onError(reason(e));
    } finally {
      setGenerating(false);
    }
  };

  const judge = async (q: TutorQuizItem) => {
    const selected = picked[q.id];
    if (!selected) return;
    try {
      const verdict = await port.tutorQuizSubmit(q.id, pid, selected);
      setVerdicts((v) => ({ ...v, [q.id]: verdict }));
      maybeWriteProgress();
    } catch (e) {
      onError(reason(e));
    }
  };

  // Aggregate judged choice accuracy per node and write it back as one
  // progress record per node.
  const maybeWriteProgress = () => {
    const choices = (items ?? []).filter((q) => q.type === "choice");
    const judged = choices.filter((q) => verdicts[q.id] !== undefined || picked[q.id]);
    if (choices.length === 0 || judged.length < choices.length) return;
    const byNode = new Map<string, { hit: number; total: number }>();
    for (const q of choices) {
      const row = byNode.get(q.node_id) ?? { hit: 0, total: 0 };
      row.total += 1;
      if (verdicts[q.id]?.correct === true) row.hit += 1;
      byNode.set(q.node_id, row);
    }
    for (const [nodeId, row] of byNode) {
      const score = row.hit / row.total;
      void port.tutorProgressRecord(pid, nodeId, score >= 0.8 ? "done" : "learning", score).catch(() => undefined);
    }
  };

  const choiceTotal = (items ?? []).filter((q) => q.type === "choice").length;
  const choiceHit = (items ?? []).filter((q) => verdicts[q.id]?.correct === true).length;

  return (
    <div className="tut-card">
      <header className="tut-plan-hd">
        <h3>{t("练习测验")}</h3>
        <button type="button" data-action="tutor.quiz-gen" disabled={generating} onClick={() => void generate()}>
          {generating ? t("出题中…") : items && items.length > 0 ? t("换一批题") : t("生成测验")}
        </button>
      </header>
      {choiceTotal > 0 && <p className="tut-dim">{t("选择题得分 {hit}/{total}", { hit: choiceHit, total: choiceTotal })}</p>}
      {items === null && <p className="tut-dim">{t("读取中…")}</p>}
      {items?.length === 0 && <p className="tut-dim">{t("还没有题目，点上面的按钮生成。")}</p>}
      {(items ?? []).map((q, i) => {
        const verdict = verdicts[q.id];
        return (
          <div className="tut-quiz" key={q.id}>
            <p className="tut-quiz-q">
              <strong>{i + 1}.</strong> {q.question}
              <span className="tut-dim"> · {q.type === "choice" ? t("单选") : q.type === "fill" ? t("填空") : t("简答")}</span>
            </p>
            {q.type === "choice" ? (
              <>
                <div role="radiogroup" aria-label={q.question}>
                  {(q.options ?? []).map((opt, j) => (
                    <label key={j} className="tut-opt">
                      <input
                        type="radio" name={q.id} data-action="tutor.quiz-pick"
                        checked={picked[q.id] === opt}
                        onChange={() => setPicked((p) => ({ ...p, [q.id]: opt }))}
                      />
                      <span className="tut-opt-badge">{j + 1}</span> {opt}
                    </label>
                  ))}
                </div>
                {!verdict && (
                  <button
                    type="button" data-action="tutor.quiz-judge" disabled={!picked[q.id]}
                    onClick={() => void judge(q)}
                  >
                    {t("判定")}
                  </button>
                )}
                {verdict && (
                  <p className={verdict.correct === true ? "tut-ok" : "tut-error"}>
                    {verdict.correct === true ? `✓ ${t("答对了")}` : `✕ ${t("再想想")}`}
                    {verdict.answer ? ` · ${t("正确答案：{answer}", { answer: verdict.answer })}` : ""}
                    {verdict.explanation ? <span className="tut-dim"> — {verdict.explanation}</span> : null}
                  </p>
                )}
              </>
            ) : (
              <>
                {revealed[q.id] && q.answer
                  ? <p className="tut-ok">{t("参考答案：{answer}", { answer: q.answer })}</p>
                  : <button type="button" data-action="tutor.quiz-reveal" onClick={() => setRevealed((r) => ({ ...r, [q.id]: true }))}>{t("显示参考答案")}</button>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
