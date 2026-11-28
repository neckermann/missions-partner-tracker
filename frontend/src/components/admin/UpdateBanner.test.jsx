import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import UpdateBanner from "./UpdateBanner.jsx";
import BackupReminder from "./BackupReminder.jsx";
import { fetchVersionCheck, fetchBackupCheck } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({ fetchVersionCheck: vi.fn(), fetchBackupCheck: vi.fn() }));
let current;
vi.mock("../../hooks/useCurrentUser.js", () => ({ default: () => current }));
vi.mock("../../hooks/useNotifications.js", () => ({
  default: () => ({ categories: [], markSeen: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fetchVersionCheck.mockResolvedValue({ updateAvailable: false });
  fetchBackupCheck.mockResolvedValue({ provider: "other" });
});

describe("the admin-only update and backup checks", () => {
  it("are asked for when an admin is signed in", async () => {
    current = { loading: false, isAdmin: true };
    render(
      <>
        <UpdateBanner />
        <BackupReminder />
      </>
    );
    await waitFor(() => expect(fetchVersionCheck).toHaveBeenCalled());
    expect(fetchBackupCheck).toHaveBeenCalled();
  });

  it("are not asked for anyone else, so nobody gets a 403 on every page", async () => {
    current = { loading: false, isAdmin: false };
    render(
      <>
        <UpdateBanner />
        <BackupReminder />
      </>
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchVersionCheck).not.toHaveBeenCalled();
    expect(fetchBackupCheck).not.toHaveBeenCalled();
  });

  it("wait until the person is known", async () => {
    current = { loading: true, isAdmin: false };
    render(<UpdateBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchVersionCheck).not.toHaveBeenCalled();
  });
});
