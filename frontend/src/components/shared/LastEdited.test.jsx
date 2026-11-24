import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LastEdited from "./LastEdited.jsx";

describe("LastEdited", () => {
  it("names who last edited the record and when", () => {
    render(<LastEdited name="Dana Whitfield" at="2026-11-24T15:00:00Z" />);
    expect(screen.getByText(/Last edited by Dana Whitfield on/)).toBeInTheDocument();
  });

  it("shows nothing for a record no signed-in person has changed", () => {
    const { container } = render(<LastEdited name={null} at={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing without a date", () => {
    const { container } = render(<LastEdited name="Dana Whitfield" at={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says when a record was added, with or without an editor", () => {
    render(<LastEdited name={null} at={null} createdAt="2026-11-10T15:00:00Z" />);
    expect(screen.getByText(/^Added /)).toBeInTheDocument();
    expect(screen.queryByText(/Last edited/)).not.toBeInTheDocument();
  });

  it("puts the added date before the last edit on one line", () => {
    render(<LastEdited name="Dana Whitfield" at="2026-11-24T15:00:00Z" createdAt="2026-11-10T15:00:00Z" />);
    expect(screen.getByText(/^Added .* · Last edited by Dana Whitfield on /)).toBeInTheDocument();
  });
});
