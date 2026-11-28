import { describe, it, expect } from "vitest";
import { isFollowUpOpen } from "./followUp.js";

const entry = (id, contactDate, createdAt, followUpDate = null) => ({
  id,
  contactDate,
  createdAt,
  followUpDate,
});

describe("isFollowUpOpen", () => {
  const first = entry("a", "2026-10-01", "2026-10-01T10:00:00Z", "2026-10-15");
  it("is open while nothing later is logged", () => {
    expect(isFollowUpOpen(first, [first])).toBe(true);
  });
  it("is answered by a later-entered contact dated on or after it", () => {
    expect(isFollowUpOpen(first, [first, entry("b", "2026-10-01", "2026-10-02T10:00:00Z")])).toBe(false);
    expect(isFollowUpOpen(first, [first, entry("b", "2026-10-20", "2026-10-21T10:00:00Z")])).toBe(false);
  });
  it("is not answered by a contact dated before it, even if entered later", () => {
    expect(isFollowUpOpen(first, [first, entry("b", "2026-09-01", "2026-10-02T10:00:00Z")])).toBe(true);
  });
  it("has nothing to show without a follow-up date", () => {
    expect(isFollowUpOpen(entry("c", "2026-10-01", "2026-10-01T10:00:00Z"), [])).toBe(false);
  });
});
