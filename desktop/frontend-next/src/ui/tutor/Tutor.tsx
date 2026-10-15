import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "../../i18n";
import type { AgentPort } from "../../port/port";
import { useEscape } from "../dismiss";
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

// consumeTutorHash answers whether the address ended in #tutor and clears it,
// so a hand-off link opens the sheet once and the address bar stops carrying
// state. Terminals and outside links point here.
export function consumeTutorHash(): boolean {
  if (window.location.hash !== "#tutor") return false;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

// The tutor sheet: one window over the tutor's page family. There is no URL
// router here, so the routes become a view union the shell switches on —
// home/generate/clarify/plans/plan/learn/review/notes/usage/kb/search.
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
  onClose: () => void;
  onError: (message: string) => void;
}

/** The sheet the app mounts: it owns its own view state, so the host only
 *  knows how to open and close it. */
export function TutorSheet({ port, onClose, onError }: { port: AgentPort; onClose: () => void; onError: (message: string) => void }) {
  const [view, setView] = useState<TutorView>({ k: "home" });
  return <Tutor port={port} view={view} onGo={setView} onClose={onClose} onError={onError} />;
}

const NAV: { key: TutorView["k"]; label: () => string; view: TutorView }[] = [
  { key: "home", label: () => t("学习目标"), view: { k: "home" } },
  { key: "plans", label: () => t("我的方案"), view: { k: "plans" } },
  { key: "review", label: () => t("复习"), view: { k: "review" } },
  { key: "notes", label: () => t("笔记"), view: { k: "notes" } },
  { key: "kb", label: () => t("知识库"), view: { k: "kb" } },
  { key: "usage", label: () => t("用量"), view: { k: "usage" } },
];

export function Tutor({ port, view, onGo, onClose, onError }: Props) {
  useEscape(true, onClose);

  useEffect(() => {
    void boot(port);
  }, [port]);

  return (
    <div className="tut-veil">
      <div className="tut" role="dialog" aria-modal="true" aria-labelledby="tut-title">
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
            <button type="button" data-action="tutor.close" onClick={onClose} aria-label={t("关闭")}>
              ✕
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
    </div>
  );
}
