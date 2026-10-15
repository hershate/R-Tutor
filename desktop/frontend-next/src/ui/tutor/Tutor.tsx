import { useEffect, useSyncExternalStore } from "react";
import { t } from "../../i18n";
import type { AgentPort } from "../../port/port";
import { boot, subscribeTasks, taskSnapshot } from "./engine";
import "./Tutor.css";
import { Home } from "./Home";
import { Generate } from "./Generate";
import { Clarify } from "./Clarify";
import { Plans } from "./Plans";
import { PlanDetail } from "./PlanDetail";
import { Learn } from "./Learn";
import { Review } from "./Review";
import { Notes } from "./Notes";
import { UsageView } from "./UsageView";
import { SearchView } from "./SearchView";
import { Kb } from "./Kb";

// consumeSurfaceHash answers which surface the address asked for — #tutor or
// #chat — and clears it, so a hand-off link opens that surface once and the
// address bar stops carrying state. Terminals and outside links point here.
export function consumeSurfaceHash(): "tutor" | "chat" | null {
  const hash = window.location.hash;
  if (hash !== "#tutor" && hash !== "#chat") return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return hash === "#tutor" ? "tutor" : "chat";
}

// The tutor is the app's surface, not a sheet over a conversation: its page
// family is what the window shows, and the agent chat is a page reached from
// the header. There is no URL router here, so the routes become a view union
// the shell switches on — home/generate/clarify/plans/plan/learn/review/
// notes/usage/kb/search.
export type TutorView =
  | { k: "home" }
  | { k: "generate"; sid: string }
  | { k: "clarify"; sid: string }
  | { k: "plans" }
  | { k: "plan"; pid: string; tab?: PlanTab }
  | { k: "learn"; pid?: string }
  | { k: "review" }
  | { k: "notes" }
  | { k: "usage" }
  | { k: "kb"; doc?: string }
  | { k: "search"; q?: string };

export type PlanTab = "outline" | "schedule" | "resources" | "validation" | "materials" | "quiz";

export function useTasks() {
  return useSyncExternalStore(subscribeTasks, taskSnapshot, taskSnapshot);
}

interface Props {
  port: AgentPort;
  view: TutorView;
  onGo: (view: TutorView) => void;
  /** Leaves the tutor for the agent chat, where Reasonix's full surface lives. */
  onChat: () => void;
  /** Opens the app settings — the model the tutor generates with is set there. */
  onSettings: () => void;
  onError: (message: string) => void;
}

export function Tutor({ port, view, onGo, onChat, onSettings, onError }: Props) {
  useEffect(() => {
    void boot(port);
  }, [port]);

  return (
    <div className="tut tut-root" aria-labelledby="tut-title">
      <header className="tut-hd">
        <h2 id="tut-title">{t("学习导师")}</h2>
        <nav className="tut-nav" aria-label={t("学习导航")}>
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              data-action="tutor.nav"
              aria-current={view.k === n.key || (n.key === "plans" && view.k === "plan") ? "page" : undefined}
              onClick={() => onGo(n.view)}
            >
              {n.label()}
            </button>
          ))}
        </nav>
        <div className="tut-hd-acts">
          <button
            type="button"
            data-action="tutor.search"
            onClick={() => onGo({ k: "search" })}
            aria-label={t("全局搜索")}
          >
            {t("搜索")}
          </button>
          <button type="button" data-action="tutor.settings" onClick={onSettings}>
            {t("设置")}
          </button>
          <button type="button" data-action="tutor.chat" onClick={onChat}>
            {t("聊天")}
          </button>
        </div>
      </header>
      <div className="tut-body">
        {view.k === "home" && <Home port={port} onGo={onGo} onError={onError} />}
        {view.k === "generate" && <Generate port={port} sid={view.sid} onGo={onGo} onError={onError} />}
        {view.k === "clarify" && <Clarify port={port} sid={view.sid} onGo={onGo} onError={onError} />}
        {view.k === "plans" && <Plans port={port} onGo={onGo} onError={onError} />}
        {view.k === "plan" && <PlanDetail port={port} pid={view.pid} initialTab={view.tab} onGo={onGo} onError={onError} />}
        {view.k === "learn" && <Learn port={port} pid={view.pid} onGo={onGo} onError={onError} />}
        {view.k === "review" && <Review port={port} onGo={onGo} onError={onError} />}
        {view.k === "notes" && <Notes port={port} onError={onError} />}
        {view.k === "usage" && <UsageView port={port} onError={onError} />}
        {view.k === "kb" && <Kb port={port} onGo={onGo} onError={onError} openDoc={view.doc} />}
        {view.k === "search" && <SearchView port={port} onGo={onGo} onError={onError} initialQ={view.q} />}
      </div>
    </div>
  );
}

const NAV: { key: TutorView["k"]; label: () => string; view: TutorView }[] = [
  { key: "home", label: () => t("学习目标"), view: { k: "home" } },
  { key: "plans", label: () => t("我的方案"), view: { k: "plans" } },
  { key: "review", label: () => t("复习"), view: { k: "review" } },
  { key: "notes", label: () => t("笔记"), view: { k: "notes" } },
  { key: "kb", label: () => t("知识库"), view: { k: "kb" } },
  { key: "usage", label: () => t("用量"), view: { k: "usage" } },
];
