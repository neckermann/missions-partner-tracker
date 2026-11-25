import { describe, it, expect } from "vitest";
import { buildGreeting, greetingHref } from "./greeting.js";

describe("greeting drafts", () => {
  it("words each occasion, names the person and the church", () => {
    const g = buildGreeting({ occasion: "Birthday", who: "Dana", churchName: "Hillside" });
    expect(g.subject).toBe("Happy birthday");
    expect(g.body).toMatch(/^Dana, Wishing you a very happy birthday!/);
    expect(g.body).toMatch(/Hillside$/);
    expect(buildGreeting({ occasion: "Commissioned" }).subject).toMatch(/commissioning/);
    expect(buildGreeting({ occasion: "Something new" }).subject).toBe("Thinking of you");
  });

  it("builds a mailto link with the text encoded", () => {
    const href = greetingHref("a+b@example.org", { subject: "Hi & hello", body: "Line one\nLine two" });
    expect(
      href.startsWith("mailto:a%2Bb@example.org?subject=Hi%20%26%20hello&body=Line%20one%0ALine%20two")
    ).toBe(true);
  });
});
