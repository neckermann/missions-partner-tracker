import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RecordUnavailable, { loadErrorStatus } from "./RecordUnavailable.jsx";

describe("loadErrorStatus", () => {
  it("reports a missing or out-of-reach record, and nothing else", () => {
    expect(loadErrorStatus({ response: { status: 404 } })).toBe(404);
    expect(loadErrorStatus({ response: { status: 403 } })).toBe(403);
    expect(loadErrorStatus({ response: { status: 500 } })).toBeNull();
    expect(loadErrorStatus(new Error("Network Error"))).toBeNull();
    expect(loadErrorStatus(undefined)).toBeNull();
  });
});

describe("RecordUnavailable", () => {
  const show = (status) =>
    render(
      <MemoryRouter>
        <RecordUnavailable
          status={status}
          what="partner"
          backTo="/admin/partners"
          backLabel="Back to Partners"
        />
      </MemoryRouter>
    );

  it("says a missing record wasn't found and links back", () => {
    show(404);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This partner wasn't found. It may have been deleted."
    );
    expect(screen.getByRole("link", { name: /Back to Partners/ })).toHaveAttribute("href", "/admin/partners");
  });

  it("says an out-of-reach record isn't theirs to open", () => {
    show(403);
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have access to this partner.");
  });
});
