import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RestoreBackupModal from "./RestoreBackupModal.jsx";
import { downloadBackup, restoreBackup } from "../../api/client.js";

// Restoring replaces everything, so: step 1 saves a copy of what is there now, and only then does the button come
// on, once the file, the password and the typed word are in. A locked file asks for its passphrase, and a failure
// says so plainly and changes nothing.
vi.mock("../../api/client.js", () => ({ downloadBackup: vi.fn(), restoreBackup: vi.fn() }));

beforeEach(() => {
  downloadBackup.mockReset();
  restoreBackup.mockReset();
});

const pick = (name) => {
  const input = screen.getByLabelText("Backup file");
  const file = new File(["x"], name, { type: "application/gzip" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = () => screen.getByRole("button", { name: /Restore and replace everything/ });
const saveCopy = async (name = "backup-2026.ndjson.gz") => {
  downloadBackup.mockResolvedValueOnce(name);
  type("Your password", "pw");
  fireEvent.click(screen.getByRole("button", { name: "Download a copy" }));
  await screen.findByText(`Saved as ${name}`);
};

describe("RestoreBackupModal", () => {
  it("says plainly that it replaces everything and that step 1 saves a copy first", () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    expect(screen.getByText(/replaces everything/)).toBeTruthy();
    expect(screen.getByText(/Step 1 downloads a copy of the current data first/)).toBeTruthy();
  });

  it("the copy is downloaded with the password, and locked when a passphrase is asked for", async () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    await saveCopy();
    expect(downloadBackup).toHaveBeenCalledWith({ password: "pw", passphrase: "" });
  });

  it("stays disabled until the copy is saved, then until a file and the exact word RESTORE are given", async () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    pick("backup.ndjson.gz");
    type("Your password", "pw");
    type(/Type RESTORE to confirm/, "RESTORE");
    expect(button().disabled).toBe(true); // no copy yet
    await saveCopy();
    type(/Type RESTORE to confirm/, "restore");
    expect(button().disabled).toBe(true);
    type(/Type RESTORE to confirm/, "RESTORE");
    expect(button().disabled).toBe(false);
  });

  it("a locked file asks for its passphrase and holds the button until it is given", async () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    await saveCopy();
    pick("backup.ndjson.gz.locked");
    type(/Type RESTORE to confirm/, "RESTORE");
    expect(button().disabled).toBe(true);
    type(/Its passphrase/, "correct horse battery");
    expect(button().disabled).toBe(false);
  });

  it("sends everything, then points to the saved copy and the sign-in", async () => {
    restoreBackup.mockResolvedValue({ restored: true, rows: 10 });
    render(<RestoreBackupModal onClose={() => {}} />);
    await saveCopy("before.ndjson.gz");
    const file = pick("backup.ndjson.gz");
    type(/Type RESTORE to confirm/, "RESTORE");
    fireEvent.click(button());
    await screen.findByText("before.ndjson.gz");
    expect(restoreBackup).toHaveBeenCalledWith({
      file,
      password: "pw",
      confirmation: "RESTORE",
      passphrase: "",
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("a failure shows the server's reason, and the form is still there to try again", async () => {
    restoreBackup.mockRejectedValueOnce(new Error("Checksum mismatch -- this backup file is corrupted"));
    render(<RestoreBackupModal onClose={() => {}} />);
    await saveCopy();
    pick("backup.ndjson.gz");
    type(/Type RESTORE to confirm/, "RESTORE");
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Checksum mismatch/);
    expect(button()).toBeTruthy();
  });

  it("checks the copy's passphrase length before downloading", () => {
    render(<RestoreBackupModal onClose={() => {}} />);
    type("Your password", "pw");
    fireEvent.click(screen.getByLabelText(/Lock the copy with a passphrase/));
    type(/Passphrase for the copy/, "short");
    fireEvent.click(screen.getByRole("button", { name: "Download a copy" }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least 8/);
    expect(downloadBackup).not.toHaveBeenCalled();
  });
});
