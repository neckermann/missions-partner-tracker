import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TemplatePackButtons from "./TemplatePackButtons.jsx";
import { previewTemplatePack, importTemplatePack } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({
  previewTemplatePack: vi.fn(),
  importTemplatePack: vi.fn(),
  templatePackExportUrl: (kind, params = {}) =>
    `/api/template-packs/export/${kind}?${new URLSearchParams(params)}`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  previewTemplatePack.mockResolvedValue({
    kind: "supportMenu",
    kindLabel: "Support menu",
    title: "Example menu",
    description: "A starting list",
    summary: ["18 support options, in 5 groups"],
  });
  importTemplatePack.mockResolvedValue({ message: "Added 18 support options." });
});

describe("TemplatePackButtons", () => {
  it("checks a pasted pack, shows what it would do, and only then imports", async () => {
    const onImported = vi.fn();
    render(<TemplatePackButtons importLabel="Import a menu…" onImported={onImported} />);
    fireEvent.click(screen.getByRole("button", { name: "Import a menu…" }));
    fireEvent.change(screen.getByLabelText(/paste it here/), { target: { value: '{"kind":"supportMenu"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Check this pack" }));
    expect(await screen.findByText("18 support options, in 5 groups")).toBeInTheDocument();
    expect(importTemplatePack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 18 support options.")).toBeInTheDocument();
    expect(importTemplatePack).toHaveBeenCalledWith('{"kind":"supportMenu"}');
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("shows the server's reason for a pack it can't read", async () => {
    previewTemplatePack.mockRejectedValue({ response: { data: { error: "That isn't valid JSON" } } });
    render(<TemplatePackButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Import…" }));
    fireEvent.change(screen.getByLabelText(/paste it here/), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Check this pack" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That isn't valid JSON");
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("offers an export link only when there is something to export", () => {
    const { rerender } = render(<TemplatePackButtons />);
    expect(screen.queryByRole("link", { name: "Export" })).toBeNull();
    rerender(<TemplatePackButtons exportKind="survey" exportParams={{ surveyId: "s1" }} />);
    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute(
      "href",
      "/api/template-packs/export/survey?surveyId=s1"
    );
  });
});
