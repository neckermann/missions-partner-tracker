import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmptyListMessage, { filtersActive } from "./EmptyListMessage.jsx";

describe("filtersActive", () => {
  const defaults = { status: "all", search: "", archived: false };
  it("is false at the defaults, and true when any filter is off its default", () => {
    expect(filtersActive({ status: "all", search: "", archived: false }, defaults)).toBe(false);
    expect(filtersActive({ status: "open", search: "", archived: false }, defaults)).toBe(true);
    expect(filtersActive({ status: "all", search: "kenya", archived: false }, defaults)).toBe(true);
    expect(filtersActive({ status: "all", search: "", archived: true }, defaults)).toBe(true);
  });
});

describe("EmptyListMessage", () => {
  it("with filters on, says nothing matches and offers to clear them", () => {
    const onClear = vi.fn();
    render(
      <EmptyListMessage filtered filteredText="No partners match these filters." onClear={onClear}>
        Nothing yet.
      </EmptyListMessage>
    );
    expect(screen.getByText(/No partners match these filters/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("with no filters, says what the list is for and shows the first step, never 'match these filters'", () => {
    render(
      <EmptyListMessage filtered={false} filteredText="No partners match these filters.">
        Nothing yet. <button>Add the first one</button>
      </EmptyListMessage>
    );
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add the first one" })).toBeInTheDocument();
    expect(screen.queryByText(/match these filters/)).toBeNull();
  });
});
