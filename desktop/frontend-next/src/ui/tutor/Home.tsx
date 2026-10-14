import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { reason } from "../../i18n/kernel";
import type { AgentPort } from "../../port/port";
import type { TutorBackupCounts, TutorPlanSummary, TutorSession, TutorShareEntry } from "../../port/tutor";
import * as engine from "./engine";
import type { TutorView } from "./Tutor";

// Home is Deep-tutor's Home.tsx: the big goal box with structured time
// fields, plus the running tasks and recent plans to jump back into.
interface Props {
  port: AgentPort;
  onGo: (view: TutorView) => void;
  onError: (message: string) => void;
}

const DRAFT_KEY = "tutor_home_draft";

export function Home({ port, onGo, onError }: Props) {
  const [text, setText] = useState(() => localStorage.getItem(DRAFT_KEY) ?? "");
  const [daily, setDaily] = useState("");
  const [deadline, setDeadline] = useState("");
  const [starting, setStarting] = useState(false);
  const [plans, setPlans] = useState<TutorPlanSummary[]>([]);
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [shares, setShares] = useState<TutorShareEntry[]>([]);
  const [backupPreview, setBackupPreview] = useState<TutorBackupCounts | null>(null);
  const [backupSummary, setBackupSummary] = useState<TutorBackupCounts | null>(null);
  const [backupB64, setBackupB64] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    port.tutorPlans().then(setPlans).catch(() => setPlans([]));
    port.tutorSessions().then(setSessions).catch(() => setSessions([]));
    port.tutorShares().then((r) => setShares(r.shares)).catch(() => setShares([]));
  }, [port]);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, text);
  }, [text]);

  const start = async () => {
    if (text.trim() === "" || starting) return;
    setStarting(true);
    try {
      const session = await port.tutorCreateSession();
      // Navigate first: the stream belongs to the engine, and the progress
      // view subscribes — waiting here would freeze the sheet on a whole
      // generation.
      onGo({ k: "generate", sid: session.id });
      await engine.startGenerate(port, session.id, text.trim(), {
        daily_minutes: Number(daily) > 0 ? Number(daily) : undefined,
        deadline: deadline || undefined,
      });
    } catch (e) {
      onError(reason(e));
    } finally {
      setStarting(false);
    }
  };

  const running = sessions.filter((s) => s.status === "running" || s.status === "paused_clarify");

  const exportBackup = async () => {
    setBackupBusy(true);
    try {
      const blob = await port.tutorBackupExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reasonix-tutor-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(reason(e));
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseBackup = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setBackupBusy(true);
    setBackupSummary(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const b64 = btoa(binary);
      setBackupB64(b64);
      setBackupPreview(await port.tutorBackupPreview(b64));
    } catch (e) {
      setBackupPreview(null);
      onError(reason(e));
    } finally {
      setBackupBusy(false);
      if (backupInput.current) backupInput.current.value = "";
    }
  };

  const importBackup = async () => {
    if (!backupB64) return;
    setBackupBusy(true);
    try {
      setBackupSummary(await port.tutorBackupImport(backupB64));
      setBackupPreview(null);
      setBackupB64("");
      port.tutorPlans().then(setPlans).catch(() => undefined);
      port.tutorSessions().then(setSessions).catch(() => undefined);
    } catch (e) {
      onError(reason(e));
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className="tut-page">
      <section className="tut-card">
        <label className="tut-label" htmlFor="tut-goal">{t("我想学会…")}</label>
        <textarea
          id="tut-goal"
          className="tut-goal"
          data-action="tutor.goal"
          rows={5}
          maxLength={4000}
          placeholder={t("用一段话描述你的学习目标，例如：三个月内掌握 React，每天能投入一小时")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="tut-fields">
          <label>
            <span>{t("每天可投入（分钟）")}</span>
            <input
              type="number" min={10} max={1440} data-action="tutor.daily"
              value={daily} onChange={(e) => setDaily(e.target.value)}
            />
          </label>
          <label>
            <span>{t("目标完成日期")}</span>
            <input
              type="date" data-action="tutor.deadline"
              value={deadline} onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button" className="tut-primary" data-action="tutor.start"
          disabled={text.trim() === "" || starting} onClick={() => void start()}
        >
          {starting ? t("正在创建…") : t("制定学习方案")}
        </button>
        <p className="tut-hint">{t("生成会经过意图理解、知识图谱、阶段设计、资源检索、排程与校验八道工序，全程可中断。")}</p>
      </section>

      {running.length > 0 && (
        <section className="tut-card">
          <h3>{t("进行中的任务")}</h3>
          <ul className="tut-list">
            {running.map((s) => (
              <li key={s.id}>
                <button
                  type="button" data-action="tutor.attach"
                  onClick={() => onGo({ k: s.status === "paused_clarify" ? "clarify" : "generate", sid: s.id })}
                >
                  {s.title || t("未命名目标")}
                  <span className="tut-dim"> · {s.status === "paused_clarify" ? t("待澄清") : t("生成中")}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tut-card">
        <h3>{t("最近方案")}</h3>
        {plans.length === 0 ? (
          <p className="tut-dim">{t("还没有方案，从上面开始第一个。")}</p>
        ) : (
          <ul className="tut-list">
            {plans.slice(0, 8).map((p) => (
              <li key={p.id}>
                <button type="button" data-action="tutor.open-plan" onClick={() => onGo({ k: "plan", pid: p.id })}>
                  {p.topic || p.title}
                  <span className="tut-dim"> · {new Date(p.updated_at).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shares.length > 0 && (
        <section className="tut-card">
          <h3>{t("活跃分享")}</h3>
          <ul className="tut-list">
            {shares.map((x) => (
              <li key={x.token}>
                <a href={x.path} target="_blank" rel="noopener noreferrer">{x.title || x.topic}</a>
                <span className="tut-dim"> · {x.created_at ? new Date(x.created_at).toLocaleDateString() : ""}</span>
                {x.plan_id && (
                  <button
                    type="button" className="tut-inline" data-action="tutor.share-revoke-list"
                    onClick={() => {
                      port.tutorShareRevoke(x.plan_id!)
                        .then(() => setShares((cur) => cur.filter((y) => y.token !== x.token)))
                        .catch((e) => onError(reason(e)));
                    }}
                  >
                    {t("撤销")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="tut-hint">{t("分享链接是只读的，任何拿到链接的人都能查看对应方案。")}</p>
        </section>
      )}

      <section className="tut-card">
        <h3>{t("备份")}</h3>
        <div className="tut-acts">
          <button type="button" data-action="tutor.backup-export" disabled={backupBusy} onClick={() => void exportBackup()}>
            {t("导出备份")}
          </button>
          <label className="tut-file-btn">
            {t("选择备份文件")}
            <input
              ref={backupInput} type="file" accept=".json,application/json"
              data-action="tutor.backup-file" disabled={backupBusy}
              onChange={(e) => void chooseBackup(e.target.files)}
            />
          </label>
        </div>
        {backupPreview && (
          <div className="tut-kb-answer">
            <p>{t("这份备份包含：")}</p>
            <p className="tut-chips">
              <span>{t("{n} 个会话", { n: Number(backupPreview.sessions ?? 0) })}</span>
              <span>{t("{n} 个方案", { n: Number(backupPreview.plans ?? 0) })}</span>
              <span>{t("{n} 条笔记", { n: Number(backupPreview.notes ?? 0) })}</span>
              <span>{t("{n} 篇知识库文档", { n: Number(backupPreview.kb_documents ?? 0) })}</span>
            </p>
            <button type="button" className="tut-primary" data-action="tutor.backup-import" disabled={backupBusy} onClick={() => void importBackup()}>
              {t("确认导入（追加，不覆盖现有数据）")}
            </button>
          </div>
        )}
        {backupSummary && (
          <p className="tut-hint">
            {t("已导入 {n} 个会话、{m} 个方案。", { n: Number(backupSummary.sessions ?? 0), m: Number(backupSummary.plans ?? 0) })}
            {Array.isArray(backupSummary.skipped) && backupSummary.skipped.length > 0
              ? t("部分内容超限未导入：{items}", { items: backupSummary.skipped.join("；") })
              : ""}
          </p>
        )}
        <p className="tut-hint">{t("备份是整个导师库的单文件 JSON：会话、方案、测验作答、进度、讲义、笔记与知识库；模型配置与密钥不在其中。")}</p>
      </section>
    </div>
  );
}
