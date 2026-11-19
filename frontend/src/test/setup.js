// Loaded before every Vitest file (see vite.config.js's `test.setupFiles`)
// -- extends expect() with jest-dom's DOM-specific matchers
// (toBeInTheDocument, etc.) for every component test.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library's auto-cleanup normally hooks itself to a *global*
// afterEach, which only exists if vitest's `test.globals` is on. This
// config deliberately doesn't turn that on (it would also leak into the
// plain utility tests), so cleanup is wired explicitly here instead --
// without it, one test's rendered component stays in the jsdom document
// for the next test, and a query like getByLabelText starts matching
// more than one element.
afterEach(() => {
  cleanup();
});
