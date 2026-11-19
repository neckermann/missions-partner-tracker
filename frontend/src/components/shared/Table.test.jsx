import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Table from "./Table.jsx";

const columns = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount", type: "currency" },
];
const rows = [
  { id: 1, name: "Alice", amount: 12 },
  { id: 2, name: "Bob", amount: 34 },
];

describe("Table", () => {
  it("renders a header and a row per item", () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("formats a currency column by default", () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByText("$12")).toBeInTheDocument();
  });

  it("shows the empty message when there are no rows", () => {
    render(<Table columns={columns} rows={[]} emptyMessage="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("fires onRowClick when a row is clicked", () => {
    const onRowClick = vi.fn();
    render(<Table columns={columns} rows={rows} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("does not propagate a click from a stopRowClick column to the row", () => {
    const onRowClick = vi.fn();
    const stopCol = [{ key: "name", label: "Name", stopRowClick: true }, columns[1]];
    render(<Table columns={stopCol} rows={rows} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders expanded content only for the matching row", () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        expandedRowId={2}
        renderExpanded={(row) => <div>Editing {row.name}</div>}
      />
    );
    expect(screen.getByText("Editing Bob")).toBeInTheDocument();
    expect(screen.queryByText("Editing Alice")).not.toBeInTheDocument();
  });
});
