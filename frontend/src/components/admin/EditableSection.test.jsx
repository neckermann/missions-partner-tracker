import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditableSection from "./EditableSection.jsx";

function Harness({ onSave, onSaved }) {
  return (
    <EditableSection
      title="Overview"
      value={{ overview: "Hello" }}
      onSave={onSave}
      onSaved={onSaved}
      view={(v) => <p>{v.overview}</p>}
      edit={(draft, set) => (
        <input value={draft.overview} onChange={(e) => set("overview", e.target.value)} />
      )}
    />
  );
}

describe("EditableSection", () => {
  it("shows a success confirmation after a save resolves", async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(<Harness onSave={onSave} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Saved ✓")).toBeInTheDocument());
  });

  it("maps a bare Zod-style error to plain language", async () => {
    const onSave = vi.fn().mockRejectedValue({
      response: { data: { error: "overview: Too small: expected string to have >=3 characters" } },
    });
    render(<Harness onSave={onSave} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("overview must be at least 3 characters")
    );
  });

  it("restores the saved value on Cancel without calling onSave", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
