import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContactCard from "./ContactCard.jsx";
import { todayInputValue } from "../../utils/format.js";

const adults = [
  {
    id: "a1",
    firstName: "Dana",
    lastName: "Reed",
    phone1: "(555) 123-4567",
    email: "dana@x.org",
    isPrimaryContact: true,
  },
];
const base = { kind: "missionary", contactSafe: true, preferredContactMethod: "WhatsApp" };

describe("ContactCard (#288)", () => {
  it("shows the primary contact, preferred method and tap actions", () => {
    render(<ContactCard partner={base} adults={adults} entries={[]} />);
    expect(screen.getByText("Dana Reed")).toBeTruthy();
    expect(screen.getByText(/primary contact/)).toBeTruthy();
    expect(screen.getByText("WhatsApp", { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:5551234567");
    expect(screen.getByRole("link", { name: "Email" }).getAttribute("href")).toBe("mailto:dana@x.org");
    expect(screen.getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe(
      "https://wa.me/15551234567"
    );
  });

  it("when not safe to contact: instructions replace the actions and the numbers", () => {
    const partner = { ...base, contactSafe: false, contactInstructions: "Email only. Never call." };
    render(<ContactCard partner={partner} adults={adults} entries={[]} />);
    expect(screen.getByText("Special communication instructions")).toBeTruthy();
    expect(screen.getByText("Email only. Never call.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Email" })).toBeNull();
    expect(screen.queryByText(/555\) 123-4567/)).toBeNull();
    expect(screen.queryByText(/dana@x.org/)).toBeNull();
  });

  it("falls back to a safe default when no instructions were written", () => {
    render(<ContactCard partner={{ ...base, contactSafe: false }} adults={adults} entries={[]} />);
    expect(screen.getByText(/Ask staff before reaching out/)).toBeTruthy();
  });

  it("says when anyone was last in touch", () => {
    const ymd = todayInputValue(new Date(Date.now() - 3 * 86400000));
    render(<ContactCard partner={base} adults={adults} entries={[{ id: "e", contactDate: ymd }]} />);
    expect(screen.getByText(/Last contact: 3 days ago/)).toBeTruthy();
  });

  it("handles no contact person and no log", () => {
    render(<ContactCard partner={{ kind: "missionary", contactSafe: true }} adults={[]} entries={[]} />);
    expect(screen.getByText(/No contact person on file/)).toBeTruthy();
    expect(screen.getByText(/No contact logged yet/)).toBeTruthy();
  });
});
