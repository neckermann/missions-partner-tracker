import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CopyButton from "./CopyButton.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("copies the text and says so", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton text="https://example.test/x" label="Copy link" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("https://example.test/x");
  });

  it("falls back to selecting a hidden field when the clipboard is blocked", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    document.execCommand = vi.fn().mockReturnValue(true);
    render(<CopyButton text="secret" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument());
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("says when it could not copy at all", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<CopyButton text="secret" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Couldn't copy/ })).toBeInTheDocument());
  });
});
