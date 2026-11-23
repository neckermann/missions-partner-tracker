import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ApiKeySettingsPage from "./ApiKeySettingsPage.jsx";

function openEditor() {
  fireEvent.click(screen.getByRole("heading", { name: "AI Features" }));
}

// #324: the plain-text `textField` (the model id) is optional and additive
// -- Joshua Project's own usage of this component passes none, which the
// existing write-only-key behavior (no textField prop at all) already
// covers; these tests are specifically about the new field.
describe("ApiKeySettingsPage -- #324 plain-text model field", () => {
  const textField = {
    key: "model",
    label: "Model",
    placeholder: "App default",
    helpText: "Leave blank to use the app's built-in default.",
  };

  it("shows 'App default' in view mode when no model is configured", async () => {
    const fetchSettings = vi.fn().mockResolvedValue({ configured: true, model: null });
    render(
      <ApiKeySettingsPage
        title="AI Features"
        description="desc"
        instructions="instructions"
        loadErrorMessage="load error"
        saveErrorMessage="save error"
        fetchSettings={fetchSettings}
        updateSettings={vi.fn()}
        textField={textField}
      />
    );
    await waitFor(() => expect(screen.getByText("Model: App default")).toBeInTheDocument());
  });

  it("shows the configured model in view mode, and prefills the edit input with it", async () => {
    const fetchSettings = vi.fn().mockResolvedValue({ configured: true, model: "claude-sonnet-5" });
    render(
      <ApiKeySettingsPage
        title="AI Features"
        description="desc"
        instructions="instructions"
        loadErrorMessage="load error"
        saveErrorMessage="save error"
        fetchSettings={fetchSettings}
        updateSettings={vi.fn()}
        textField={textField}
      />
    );
    await waitFor(() => expect(screen.getByText("Model: claude-sonnet-5")).toBeInTheDocument());

    openEditor();
    expect(screen.getByRole("textbox", { name: /^Model/ })).toHaveValue("claude-sonnet-5");
  });

  it("saving a new model value sends it (without apiKey) and updates the displayed value", async () => {
    const fetchSettings = vi.fn().mockResolvedValue({ configured: true, model: null });
    const updateSettings = vi.fn().mockResolvedValue({ configured: true, model: "claude-opus-5-mini" });
    render(
      <ApiKeySettingsPage
        title="AI Features"
        description="desc"
        instructions="instructions"
        loadErrorMessage="load error"
        saveErrorMessage="save error"
        fetchSettings={fetchSettings}
        updateSettings={updateSettings}
        textField={textField}
      />
    );
    await waitFor(() => expect(screen.getByText("Model: App default")).toBeInTheDocument());

    openEditor();
    fireEvent.change(screen.getByRole("textbox", { name: /^Model/ }), {
      target: { value: "claude-opus-5-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ model: "claude-opus-5-mini" }));
    await waitFor(() => expect(screen.getByText("Model: claude-opus-5-mini")).toBeInTheDocument());
  });

  it("clearing the model field back to blank saves it as null", async () => {
    const fetchSettings = vi.fn().mockResolvedValue({ configured: true, model: "claude-sonnet-5" });
    const updateSettings = vi.fn().mockResolvedValue({ configured: true, model: null });
    render(
      <ApiKeySettingsPage
        title="AI Features"
        description="desc"
        instructions="instructions"
        loadErrorMessage="load error"
        saveErrorMessage="save error"
        fetchSettings={fetchSettings}
        updateSettings={updateSettings}
        textField={textField}
      />
    );
    await waitFor(() => expect(screen.getByText("Model: claude-sonnet-5")).toBeInTheDocument());

    openEditor();
    fireEvent.change(screen.getByRole("textbox", { name: /^Model/ }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ model: null }));
  });

  it("without a textField prop at all, no model row/input appears -- Joshua Project's own usage is unaffected", async () => {
    const fetchSettings = vi.fn().mockResolvedValue({ configured: false });
    render(
      <ApiKeySettingsPage
        title="AI Features"
        description="desc"
        instructions="instructions"
        loadErrorMessage="load error"
        saveErrorMessage="save error"
        fetchSettings={fetchSettings}
        updateSettings={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText("Not configured")).toBeInTheDocument());
    expect(screen.queryByText(/^Model:/)).not.toBeInTheDocument();

    openEditor();
    expect(screen.queryByRole("textbox", { name: /^Model/ })).not.toBeInTheDocument();
  });
});
