import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SuggestInput from "./SuggestInput.jsx";

const OPTIONS = ["Kenya", "Kuwait", "Albania", "Nepal"];

function Harness() {
  const [v, setV] = useState("");
  return (
    <>
      <SuggestInput value={v} onChange={setV} options={OPTIONS} placeholder="Country" />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe("SuggestInput", () => {
  it("suggests matches as you type, best (prefix) matches first, and a tap fills the field", () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText("Country");
    fireEvent.focus(input);
    expect(screen.getAllByRole("option").length).toBe(4);
    fireEvent.change(input, { target: { value: "k" } });
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.slice(0, 2).sort()).toEqual(["Kenya", "Kuwait"]);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Kenya" }));
    expect(screen.getByTestId("value")).toHaveTextContent("Kenya");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("still accepts a value that isn't in the list, and works from the keyboard", () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText("Country");
    fireEvent.change(input, { target: { value: "Atlantis" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByTestId("value")).toHaveTextContent("Atlantis");
    fireEvent.change(input, { target: { value: "ne" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("value")).toHaveTextContent("Nepal");
  });
});
