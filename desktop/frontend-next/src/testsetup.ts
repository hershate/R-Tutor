import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";

configure({ asyncUtilTimeout: 10_000 });
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
}
// The app opens on the study tutor; the agent chat is the #chat surface. Most
// suites here exercise the chat surface, so every test starts on it, and the
// suites that pin the tutor surface (or the default) set their own hash — the
// address is consumed on mount, so a once-per-file write would cover only the
// first render.
if (typeof window !== "undefined") {
  beforeEach(() => {
    window.location.hash = "#chat";
  });
}
