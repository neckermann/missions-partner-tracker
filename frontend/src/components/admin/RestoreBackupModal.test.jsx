import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RestoreBackupModal from "./RestoreBackupModal.jsx";
import { restoreBackup } from "../../api/client.js";

// Restoring replaces everything, so the button stays off until the file, the password and the typed word are in,
// a locked file asks for its passphrase, and a failure says so plainly and changes nothing.
vi.mock("../../api/client.js", () => ({ restoreBackup: vi.fn() }));

beforeEach(() => restoreBackup.mockReset());

const pick = (name) => {
  const input = screen.getByLabelText("Backup file");
  const file = new File(["x"], name, { type: "application/gzip" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = () => screen.getByRole("button", { name: /Restore and replace everything/ });

describe("RestoreBackupModal", () => {
  it("says plainly that it replaces everything and that a copy of the current data is saved first", () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    expect(screen.getByText(/replaces everything/)).toBeTruthy();
    expect(screen.getByText(/copy of the current data downloads automatically/)).toBeTruthy();
  });

  it("stays disabled until a file, the password and the exact word RESTORE are given", () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    expect(button().disabled).toBe(true);
    pick("backup.ndjson.gz");
    type("Your password", "pw");
    expect(button().disabled).toBe(true);
    type(/Type RESTORE to confirm/, "restore");
    expect(button().disabled).toBe(true);
    type(/Type RESTORE to confirm/, "RESTORE");
    expect(button().disabled).toBe(false);
  });

  it("a locked file asks for its passphrase and holds the button until it is given", () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    pick("backup.ndjson.gz.locked");
    type("Your password", "pw");
    type(/Type RESTORE to confirm/, "RESTORE");
    expect(button().disabled).toBe(true);
    type(/Its passphrase/, "correct horse battery");
    expect(button().disabled).toBe(false);
  });

  it("sends everything, then points to the safety copy and the sign-in", async () => {
    restoreBackup.mockResolvedValue("before-restore-2026.ndjson.gz");
    render(<RestoreBackupModal onClose={() => {}} />);
    const file = pick("backup.ndjson.gz");
    type("Your password", "pw");
    type(/Type RESTORE to confirm/, "RESTORE");
    fireEvent.click(button());
    await screen.findByText("before-restore-2026.ndjson.gz");
    expect(restoreBackup).toHaveBeenCalledWith({
      file,
      password: "pw",
      confirmation: "RESTORE",
      passphrase: "",
      safetyPassphrase: "",
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("a failure shows the server's reason, and the form is still there to try again", async () => {
    restoreBackup.mockImplementationOnce(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Checksum mismatch -- this backup file is corrupted")), 0)
        )
    );
    render(<RestoreBackupModal onClose={() => {}} />);
    pick("backup.ndjson.gz");
    type("Your password", "pw");
    type(/Type RESTORE to confirm/, "RESTORE");
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Checksum mismatch/);
    expect(button()).toBeTruthy();
  });

  it("checks the safety-copy passphrase length before sending", () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    pick("backup.ndjson.gz");
    type("Your password", "pw");
    type(/Type RESTORE to confirm/, "RESTORE");
    fireEvent.click(screen.getByLabelText(/Lock the safety copy/));
    type(/Passphrase for the safety copy/, "short");
    fireEvent.click(button());
    expect(screen.getByRole("alert").textContent).toMatch(/at least 8/);
    expect(restoreBackup).not.toHaveBeenCalled();
  });
});
