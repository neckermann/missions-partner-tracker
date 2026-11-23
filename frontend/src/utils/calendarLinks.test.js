import { describe, it, expect } from "vitest";
import { buildCalendarLinks, meetingDescription } from "./calendarLinks.js";

const base = {
  title: "Team kickoff & prayer",
  startAt: "2026-03-04T15:00:00.000Z",
  location: "Room 2, Main St",
  description: "Bring a Bible",
};

describe("buildCalendarLinks", () => {
  it("builds all four links with a one-hour default", () => {
    const l = buildCalendarLinks(base);
    expect(l.google).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(l.google).toContain("dates=20260304T150000Z%2F20260304T160000Z");
    expect(l.outlook).toContain("https://outlook.live.com/calendar/0/deeplink/compose?");
    expect(l.office365).toContain("https://outlook.office.com/calendar/0/deeplink/compose?");
    expect(l.outlook).toContain("startdt=2026-03-04T15%3A00%3A00.000Z");
    expect(l.outlook).toContain("enddt=2026-03-04T16%3A00%3A00.000Z");
    expect(l.yahoo).toContain("st=20260304T150000Z");
    expect(l.yahoo).toContain("dur=0100");
  });

  it("percent-encodes titles (no + for spaces, & can't break the query)", () => {
    const l = buildCalendarLinks(base);
    expect(l.outlook).toContain("subject=Team%20kickoff%20%26%20prayer");
    expect(l.google).toContain("text=Team%20kickoff%20%26%20prayer");
    expect(l.outlook).not.toContain("+");
  });

  it("omits empty optional fields and falls back to a default title", () => {
    const l = buildCalendarLinks({ startAt: base.startAt });
    expect(l.google).toContain("text=Trip%20meeting");
    expect(l.google).not.toContain("location=");
    expect(l.yahoo).not.toContain("in_loc=");
  });

  it("honors a custom duration", () => {
    const l = buildCalendarLinks({ ...base, durationMinutes: 90 });
    expect(l.yahoo).toContain("dur=0130");
    expect(l.google).toContain("20260304T163000Z");
  });

  it("returns null when there's no usable start time", () => {
    expect(buildCalendarLinks({ title: "x" })).toBeNull();
    expect(buildCalendarLinks({ title: "x", startAt: "not a date" })).toBeNull();
  });
});

describe("meetingDescription", () => {
  it("joins agenda and join link, skipping blanks", () => {
    expect(meetingDescription({ agenda: "A", meetingLink: "https://x.test" })).toBe(
      "A\n\nJoin online: https://x.test"
    );
    expect(meetingDescription({ agenda: null, meetingLink: null })).toBe("");
  });
});
