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
  { name: "search", label: "Search" },
];

describe("FilterBar", () => {
  it("renders a labeled control per field, skipping the pills field", () => {
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", search: "" }}
        onChange={() => {}}
        onReset={() => {}}
        pills={{ field: "status", options: [{ value: "active", label: "Active" }] }}
      />
    );
    expect(screen.getByText("Kind")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toBeInTheDocument();
  });

  it("calls onChange with the field name and new value", () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", search: "" }}
        onChange={onChange}
        onReset={() => {}}
      />
    );
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "trip" } });
    expect(onChange).toHaveBeenCalledWith("search", "trip");
  });

  it("calls onReset when Reset Filters is clicked", () => {
    const onReset = vi.fn();
    render(
      <FilterBar
        fields={fields}
        values={{ status: "active", kind: "all", search: "" }}
        onChange={() => {}}
        onReset={onReset}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Filters" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("hides a field whose showWhen condition isn't met", () => {
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
    expect(screen.queryByText("Year")).not.toBeInTheDocument();
  });
});
