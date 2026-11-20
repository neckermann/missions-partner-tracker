import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterBar from "./FilterBar.jsx";

const fields = [
  { name: "status" },
  {
    name: "kind",
    label: "Kind",
    type: "select",
    options: [
      { value: "all", label: "All" },
      { value: "open", label: "Open" },
    ],
  },
  { name: "showArchived", label: "Show archived", type: "checkbox" },
  { name: "search", label: "Search" },
];

describe("FilterBar", () => {
  it("renders the search box and pills, keeping a default-valued field behind Add filter", () => {
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", search: "" }}
        onChange={() => {}}
        onReset={() => {}}
        pills={{ field: "status", options: [{ value: "active", label: "Active" }] }}
      />
    );
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toBeInTheDocument();
    expect(screen.queryByText("Kind:")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    expect(screen.getByText("Kind")).toBeInTheDocument();
  });

  it("shows a non-default field as a removable chip", () => {
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "open", search: "" }}
        onChange={() => {}}
        onReset={() => {}}
      />
    );
    expect(screen.getByText("Kind:")).toBeInTheDocument();
  });

  it("removing a chip resets that field to its default", () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "open", search: "" }}
        onChange={onChange}
        onReset={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Kind filter" }));
    expect(onChange).toHaveBeenCalledWith("kind", "all");
  });

  it("debounces the search box before calling onChange", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", search: "" }}
        onChange={onChange}
        onReset={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "trip" } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith("search", "trip");
    vi.useRealTimers();
  });

  it("calls onReset when Clear all is clicked", () => {
    const onReset = vi.fn();
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "open", search: "" }}
        onChange={() => {}}
        onReset={onReset}
      />
    );
    fireEvent.click(screen.getByText("Clear all"));
    expect(onReset).toHaveBeenCalled();
  });

  it("adding a checkbox field from the popover turns it on directly, with no inner checkbox in the chip", () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", showArchived: false, search: "" }}
        onChange={onChange}
        onReset={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    fireEvent.click(screen.getByText("Show archived"));
    expect(onChange).toHaveBeenCalledWith("showArchived", true);
  });

  it("an active checkbox chip has no inner checkbox input", () => {
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", showArchived: true, search: "" }}
        onChange={() => {}}
        onReset={() => {}}
      />
    );
    const chip = screen.getByText("Show archived").closest(".filter-chip");
    expect(chip.querySelector("input")).not.toBeInTheDocument();
  });

  it("hides a field whose showWhen condition isn't met, even from Add filter", () => {
    const conditional = [
      ...fields,
      { name: "year", label: "Year", type: "number", showWhen: { field: "kind", equals: "open" } },
    ];
    render(
      <FilterBar
        fields={conditional}
        values={{ status: "active", kind: "all", search: "" }}
        onChange={() => {}}
        onReset={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    expect(screen.queryByText("Year")).not.toBeInTheDocument();
  });
});
