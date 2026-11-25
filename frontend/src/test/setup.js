// Loaded before every Vitest file: adds jest-dom matchers.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Cleanup is wired explicitly because `test.globals` is off (turning it on would leak into the
// plain utility tests); without it rendered components persist across tests.
afterEach(() => {
  cleanup();
});
