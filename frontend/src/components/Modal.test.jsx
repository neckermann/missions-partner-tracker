import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "./Modal.jsx";

describe("Modal", () => {
  // Regression: a modal rendered inside a clickable row/card (the care team line) let the Close click bubble
  // to the row, which reopened it, so Close seemed to do nothing.
  it("does not let clicks inside it reach a clickable parent", () => {
    const onParentClick = vi.fn();
    const onClose = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onParentClick}>
        <Modal title="Care team" onClose={onClose}>
          <p>body</p>
        </Modal>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("body"));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
