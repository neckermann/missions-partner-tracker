import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BackupDownloadModal from "./BackupDownloadModal.jsx";
import { downloadBackup } from "../../api/client.js";

// Downloading a backup asks for the admin's password again and can lock the file with a passphrase the app
// cannot recover. Nothing is requested until the form is complete.
vi.mock("../../api/client.js", () => ({ downloadBackup: vi.fn() }));

beforeEach(() => downloadBackup.mockReset());

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("BackupDownloadModal", () => {
  it("won't ask the server without a password", () => {
    render(<BackupDownloadModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Enter your password/);
    expect(downloadBackup).not.toHaveBeenCalled();
  });

  it("downloads unlocked with just the password", async () => {
    downloadBackup.mockResolvedValue("backup-1.ndjson.gz");
    render(<BackupDownloadModal onClose={() => {}} />);
    fill("Your password", "hunter2hunter2");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await screen.findByText(/backup-1.ndjson.gz/);
    expect(downloadBackup).toHaveBeenCalledWith({ password: "hunter2hunter2", passphrase: "" });
  });

  it("warns plainly that a lost passphrase cannot be recovered", () => {
    render(<BackupDownloadModal onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Lock the file with a passphrase/));
    expect(screen.getByText(/nobody can open the backup, including us/)).toBeTruthy();
  });

  it("checks the passphrase length and that both entries match before sending", () => {
    render(<BackupDownloadModal onClose={() => {}} />);
    fill("Your password", "pw");
    fireEvent.click(screen.getByLabelText(/Lock the file with a passphrase/));
    fill("Passphrase", "short");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least 8/);
    fill("Passphrase", "long enough one");
    fill("Passphrase again", "different one");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getByRole("alert").textContent).toMatch(/don't match/);
    expect(downloadBackup).not.toHaveBeenCalled();
  });

  it("sends the passphrase when locking, and reminds the admin to keep it after", async () => {
    downloadBackup.mockResolvedValue("backup-1.ndjson.gz.locked");
    render(<BackupDownloadModal onClose={() => {}} />);
    fill("Your password", "pw");
    fireEvent.click(screen.getByLabelText(/Lock the file with a passphrase/));
    fill("Passphrase", "long enough one");
    fill("Passphrase again", "long enough one");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await screen.findByText(/locked with your passphrase/);
    expect(downloadBackup).toHaveBeenCalledWith({ password: "pw", passphrase: "long enough one" });
  });

  it("shows the server's reason when the password is wrong", async () => {
    downloadBackup.mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("That password isn't right")), 0))
    );
    render(<BackupDownloadModal onClose={() => {}} />);
    fill("Your password", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/isn't right/);
  });
});
