import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminSystemInfo from "./AdminSystemInfo.jsx";
import * as client from "../api/client.js";

vi.mock("../api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSystemInfo: vi.fn(),
  fetchChurchSettings: vi.fn().mockResolvedValue({}),
}));

const base = {
  app: { version: "0.1.0-beta.4", updateAvailable: false },
  runtime: { node: "v22" },
  dependencies: { express: "5", prisma: "7", prismaClient: "7" },
  database: { version: "PostgreSQL 16", sizeBytes: 1024 },
  deployment: { onRender: false },
};

beforeEach(() => vi.clearAllMocks());

const open = () =>
  render(
    <MemoryRouter>
      <AdminSystemInfo />
    </MemoryRouter>
  );

describe("System Info warnings", () => {
  it("shows the testing-site warning at the top when the server reports one", async () => {
    client.fetchSystemInfo.mockResolvedValue({
      ...base,
      warnings: ["DEMO_TESTING_SITE is set, so this site is a testing site."],
    });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("DEMO_TESTING_SITE is set");
  });

  it("shows nothing extra when there are no warnings", async () => {
    client.fetchSystemInfo.mockResolvedValue({ ...base, warnings: [] });
    open();
    expect(await screen.findByText("v0.1.0-beta.4")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
