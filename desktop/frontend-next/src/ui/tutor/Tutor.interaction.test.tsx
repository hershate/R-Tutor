// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../testkit";
import { MockPort } from "../../port/mock";
import type { AgentPort } from "../../port/port";
import { Tutor } from "./Tutor";
import { QuizPanel } from "./QuizPanel";
import type { TutorView } from "./Tutor";

afterEach(cleanup);

function mounted() {
  const port = new MockPort() as unknown as AgentPort;
  const views: TutorView[] = [{ k: "home" }];
  const tree = (v: TutorView) => (
    <Tutor port={port} view={v} onGo={go} onChat={() => undefined} onSettings={() => undefined} onError={() => undefined} />
  );
  // Defined after render hands it back; go only runs on a later click.
  let rerender: (v: TutorView) => void = () => undefined;
  const go = (v: TutorView) => {
    views[0] = v;
    rerender(v);
  };
  const utils = render(tree(views[0]!));
  rerender = (v) => utils.rerender(tree(v));
  return { port, go, views, ...utils };
}

// The pane's page navigation lives in the shell's session rail, not inside
// the pane; a standalone pane switches pages through its host, which is what
// the harness's go stands in for.
it("opens on the goal page", async () => {
  mounted();
  const start = await screen.findByRole("button", { name: "制定学习方案" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
});

it("runs a generation end to end: goal → progress steps → plan view", async () => {
  const user = userEvent.setup();
  const { views } = mounted();
  const box = await screen.findByPlaceholderText(/用一段话描述你的学习目标/);
  await user.type(box, "三个月掌握 React");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));

  // The scripted stream walks two tools then lands done; the sheet switches
  // to the progress view first.
  await screen.findByText("正在生成你的学习方案");
  await waitFor(() => {
    expect(screen.getByText(/理解学习目标/)).toBeTruthy();
  });

  // done switches to the plan view after the redirect beat.
  await waitFor(() => {
    expect(views[0]?.k).toBe("plan");
  }, { timeout: 5000 });
  expect((await screen.findAllByText(/组件与 JSX/)).length).toBeGreaterThan(0);
});

it("shares a plan read-only, then revokes it", async () => {
  const user = userEvent.setup();
  const { views } = mounted();
  const box = await screen.findByPlaceholderText(/用一段话描述你的学习目标/);
  await user.type(box, "三个月掌握 React");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));
  await waitFor(() => {
    expect(views[0]?.k).toBe("plan");
  }, { timeout: 5000 });

  // Create the share: the header swaps the button for the link surface.
  await user.click(await screen.findByRole("button", { name: "只读分享" }));
  const revoke = await screen.findByRole("button", { name: "撤销分享" });
  expect(screen.getByRole("link", { name: "查看分享页" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "复制链接" })).toBeTruthy();

  // Revoke: the create button comes back and the link surface is gone.
  await user.click(revoke);
  await screen.findByRole("button", { name: "只读分享" });
  expect(screen.queryByRole("link", { name: "查看分享页" })).toBeNull();
});

it("previews a backup file before importing it", async () => {
  const user = userEvent.setup();
  mounted();
  // The mock preview reports the demo store's own (empty) counts; the flow
  // under test is upload → preview card → confirm → summary.
  const input = await screen.findByLabelText("选择备份文件");
  const file = new File(["{\"format\":\"reasonix-tutor-backup\"}"], "backup.json", { type: "application/json" });
  await user.upload(input, file);
  expect(await screen.findByText("这份备份包含：")).toBeTruthy();
  expect(screen.getByText("0 个会话")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /确认导入/ }));
  await waitFor(() => {
    expect(screen.getByText(/已导入 0 个会话/)).toBeTruthy();
  });
});

it("exports the plan as an Anki deck, its wrong-book, slides, and degraded pdf", async () => {
  const user = userEvent.setup();
  const { port } = mounted();
  const box = await screen.findByPlaceholderText(/用一段话描述你的学习目标/);
  await user.type(box, "三个月掌握 React");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "导出 Anki 卡片" })).toBeTruthy();
  }, { timeout: 5000 });

  // jsdom has neither blob URLs nor downloads; capture the port calls.
  const calls: Array<[string, boolean | undefined]> = [];
  port.tutorPlanApkg = async (id: string, wrongOnly?: boolean) => {
    calls.push([id, wrongOnly]);
    return new Blob(["pk"], { type: "application/octet-stream" });
  };
  const slideCalls: string[] = [];
  port.tutorPlanSlides = async (id: string) => {
    slideCalls.push(id);
    return "<!DOCTYPE html><html><body>deck</body></html>";
  };
  const pdfCalls: string[] = [];
  port.tutorPlanPDF = async (id: string) => {
    pdfCalls.push(id);
    return { content: "# md", degraded: true };
  };
  HTMLAnchorElement.prototype.click = () => undefined;
  URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  await user.click(screen.getByRole("button", { name: "导出 Anki 卡片" }));
  await user.click(screen.getByRole("button", { name: "导出错题卡片" }));
  await user.click(screen.getByRole("button", { name: "导出幻灯片" }));
  await user.click(screen.getByRole("button", { name: "导出 PDF" }));
  await waitFor(() => {
    expect(calls).toHaveLength(2);
    expect(slideCalls).toHaveLength(1);
    expect(pdfCalls).toHaveLength(1);
  });
  expect(calls[0]![1]).toBe(false);
  expect(calls[1]![1]).toBe(true);
  expect(calls[0]![0]).toBe(calls[1]![0]);
  expect(slideCalls[0]).toBe(calls[0]![0]);
  expect(pdfCalls[0]).toBe(calls[0]![0]);
});

it("opens the notes page, creates one, and lists it", async () => {
  const user = userEvent.setup();
  const { go } = mounted();
  go({ k: "notes" });
  expect(await screen.findByRole("button", { name: "新建" })).toBeTruthy();
  await user.click(await screen.findByRole("button", { name: "新建" }));
  const title = await screen.findByPlaceholderText("标题");
  await user.type(title, "第一篇笔记");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => {
    expect(screen.getByText("第一篇笔记")).toBeTruthy();
  });
});

it("shows the honest empty state for a session with no pending questions", async () => {
  const port = new MockPort() as unknown as AgentPort;
  const session = await port.tutorCreateSession("目标");
  const utils = render(
    <Tutor port={port} view={{ k: "clarify", sid: session.id }} onGo={() => undefined} onChat={() => undefined} onSettings={() => undefined} onError={() => undefined} />,
  );
  expect(await utils.findByText("这个会话当前没有待回答的问题。")).toBeTruthy();
});

it("files a text document and asks the knowledge base about it", async () => {
  const user = userEvent.setup();
  const { go } = mounted();
  go({ k: "kb" });
  expect(await screen.findByRole("heading", { name: /知识库/ })).toBeTruthy();
  expect(await screen.findByText(/知识库还是空的/)).toBeTruthy();

  // Text in, parsed straight away; the row shows the parsed status.
  await user.click(screen.getByRole("button", { name: "添加文本" }));
  await user.type(await screen.findByPlaceholderText("标题（可空，取正文首行）"), "Rust 手册");
  await user.type(screen.getByPlaceholderText("粘贴文本内容"), "所有权是 Rust 的核心概念。");
  await user.click(screen.getByRole("button", { name: "入库" }));
  await waitFor(() => {
    expect(screen.getAllByText(/Rust 手册/).length).toBeGreaterThan(0);
  });

  // Ask: the mock answers citing the first context document.
  await user.click(screen.getByRole("tab", { name: "问答" }));
  await user.type(await screen.findByPlaceholderText("就知识库内容提问…"), "什么是所有权？");
  await user.click(screen.getByRole("button", { name: "提问" }));
  await waitFor(() => {
    expect(screen.getByText(/演示回答/)).toBeTruthy();
  });
  // The citation chip names the source doc (the answer body names it too).
  expect(screen.getAllByText(/《Rust 手册》/).length).toBeGreaterThanOrEqual(2);
  // The question lands in the persisted history.
  await waitFor(() => {
    expect(screen.getByText("什么是所有权？")).toBeTruthy();
  });
});

// ── The home surface's coverage: staged materials, the learning-data card,
//    the review overview, and the per-plan wrong drill. ──────────────────
it("stages material rows and sends them with the goal", async () => {
  const user = userEvent.setup();
  const port = new MockPort() as unknown as AgentPort;
  const upload = vi.spyOn(port, "tutorMaterialUpload");
  const confirm = vi.spyOn(port, "tutorMaterialConfirm");
  const addUrl = vi.spyOn(port, "tutorMaterialURL");
  const views: TutorView[] = [{ k: "home" }];
  const tree = (v: TutorView) => (
    <Tutor port={port} view={v} onGo={go} onChat={() => undefined} onSettings={() => undefined} onError={() => undefined} />
  );
  let rerender: (v: TutorView) => void = () => undefined;
  const go = (v: TutorView) => {
    views[0] = v;
    rerender(v);
  };
  const utils = render(tree(views[0]!));
  rerender = (v) => utils.rerender(tree(v));

  await user.type(await screen.findByPlaceholderText(/用一段话描述你的学习目标/), "三个月学会 Rust");
  // A web page rides the session as fetched text.
  await user.type(screen.getByPlaceholderText("https://"), "https://example.com/rust-book");
  await user.click(screen.getByRole("button", { name: "添加网页" }));
  expect(screen.getByText("https://example.com/rust-book")).toBeTruthy();
  // A file rides it with the parse effort its row chose.
  const file = new File(["# Rust 概览"], "rust.md", { type: "text/markdown" });
  const input = document.querySelector('input[data-action="tutor.mat-file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await user.selectOptions(screen.getByLabelText("rust.md 的解析方式"), "fast");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));

  await screen.findByText("正在生成你的学习方案");
  await waitFor(() => {
    expect(upload).toHaveBeenCalledWith(expect.any(String), "rust.md", expect.any(String));
    expect(confirm).toHaveBeenCalledWith(expect.any(String), expect.any(String), "fast");
    expect(addUrl).toHaveBeenCalledWith(expect.any(String), "https://example.com/rust-book");
  });
});

it("renders the learning-data card from the ledger", async () => {
  const port = new MockPort() as unknown as AgentPort;
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  port.tutorStatsSummary = vi.fn(async () => ({ total_minutes: 120, today_minutes: 30, streak_days: 4, checkin_days: 9 }));
  port.tutorStatsCalendar = vi.fn(async () => ({ [key]: 45 }));
  port.tutorStatsByPlan = vi.fn(async () => [{ plan_id: "p1", topic: "Rust 入门", minutes: 80 }]);
  render(<Tutor port={port} view={{ k: "home" }} onGo={() => undefined} onChat={() => undefined} onSettings={() => undefined} onError={() => undefined} />);
  expect(await screen.findByText("学习数据")).toBeTruthy();
  expect(screen.getByText("连胜 4 天")).toBeTruthy();
  expect(screen.getByText("打卡 9 天")).toBeTruthy();
  // Twelve weeks of days, one cell each.
  const heat = document.querySelector(".tut-heat")!;
  expect(heat.querySelectorAll("i")).toHaveLength(84);
  expect(heat.querySelector('i[data-level="2"]')).toBeTruthy();
  expect(screen.getByText("Rust 入门")).toBeTruthy();
  expect(screen.getByText("80 分钟")).toBeTruthy();
});

it("shows the day's due and the wrong-book overview with plan jumps", async () => {
  const port = new MockPort() as unknown as AgentPort;
  port.tutorReviewDue = vi.fn(async () => ({ items: [], total: 3 }));
  port.tutorWrongOverview = vi.fn(async () => ({ total: 5, items: [{ plan_id: "p1", topic: "React 基础", count: 5 }] }));
  const goes: TutorView[] = [];
  render(<Tutor port={port} view={{ k: "review" }} onGo={(v) => goes.push(v)} onChat={() => undefined} onSettings={() => undefined} onError={() => undefined} />);
  expect(await screen.findByText("今日到期 3 项")).toBeTruthy();
  expect(screen.getByText("错题 5 道")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /React 基础/ }));
  expect(goes[0]).toEqual({ k: "plan", pid: "p1", tab: "quiz" });
});

it("drills a plan's wrong book through the server's judgement", async () => {
  const user = userEvent.setup();
  const port = new MockPort() as unknown as AgentPort;
  port.tutorQuizzes = vi.fn(async () => ({ title: "", quiz_count: 0, quizzes: [] }));
  port.tutorQuizWrong = vi.fn(async () => ({
    total: 1,
    items: [{ id: "q9", plan_id: "p1", node_id: "n1", type: "choice" as const, question: "Rust 的所有权规则是哪个？", options: ["一份数据只有一个所有者", "随便几个所有者"], answer: "一份数据只有一个所有者" }],
  }));
  port.tutorQuizSubmit = vi.fn(async () => ({ correct: true }));
  render(<QuizPanel port={port} pid="p1" onError={() => undefined} />);
  await user.click(await screen.findByRole("button", { name: "取本方案错题" }));
  expect(await screen.findByText(/Rust 的所有权规则是哪个？/)).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: /一份数据只有一个所有者/ }));
  await user.click(screen.getByRole("button", { name: "判定" }));
  expect(await screen.findByText(/出了错题本/)).toBeTruthy();
  expect(port.tutorQuizSubmit).toHaveBeenCalledWith("q9", "p1", "一份数据只有一个所有者");
});
