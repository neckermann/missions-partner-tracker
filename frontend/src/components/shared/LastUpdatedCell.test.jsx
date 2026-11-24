import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LastUpdatedCell, { lastUpdatedSortKey } from "./LastUpdatedCell.jsx";

describe("LastUpdatedCell", () => {
  it("shows the date and who", () => {
    render(<LastUpdatedCell at="2026-11-24T15:00:00Z" name="Dana Whitfield" />);
    expect(screen.getByText("by Dana Whitfield")).toBeInTheDocument();
  });

  it("shows a dash for a record nobody has changed", () => {
    render(<LastUpdatedCell at={null} name={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("sorts blanks last and newer after older", () => {
    expect(lastUpdatedSortKey(null)).toBeNull();
    expect(lastUpdatedSortKey("2026-11-25T00:00:00Z")).toBeGreaterThan(
      lastUpdatedSortKey("2026-11-24T00:00:00Z")
    );
  });
});
