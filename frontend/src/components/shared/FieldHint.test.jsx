import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FieldHint from "./FieldHint.jsx";
import EmailInput from "./EmailInput.jsx";
import PhoneField from "./PhoneField.jsx";

// Leaving a box must not move what is below it: a hint that appeared on blur used to push the Save button away,
// and the tap on it was lost. The note is laid out, invisibly, before the box is left.
describe("FieldHint", () => {
  it("takes no room when there is no note", () => {
    const { container } = render(<FieldHint text="" show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("holds its place invisibly before the box is left, and shows as a status after", () => {
    const { rerender } = render(<FieldHint id="h" text="Fix this" show={false} />);
    const hidden = screen.getByText("Fix this");
    expect(hidden.style.visibility).toBe("hidden");
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<FieldHint id="h" text="Fix this" show />);
    expect(screen.getByRole("status")).toHaveTextContent("Fix this");
    expect(screen.getByText("Fix this").style.visibility).toBe("visible");
  });
});

describe("a field's note does not move the page when the box is left", () => {
  it("email: the note is in the page (hidden) before blur and visible after, in the same place", () => {
    render(<EmailInput value="not an email" onChange={() => {}} aria-label="Email" />);
    const note = screen.getByText("That doesn't look like an email address.");
    expect(note.style.visibility).toBe("hidden");
    fireEvent.blur(screen.getByLabelText("Email"));
    expect(screen.getByText("That doesn't look like an email address.")).toBe(note);
    expect(note.style.visibility).toBe("visible");
  });

  it("email: a valid address reserves nothing", () => {
    render(<EmailInput value="a@b.org" onChange={() => {}} aria-label="Email" />);
    expect(screen.queryByText(/doesn't look like/)).toBeNull();
  });

  it("phone: a number that won't pass reserves its note before blur, and shows it after", () => {
    render(<PhoneField label="Phone" value="12" onChange={() => {}} />);
    const note = screen.getByText(/doesn't look like a phone number/);
    expect(note.style.visibility).toBe("hidden");
    fireEvent.blur(screen.getByLabelText("Phone"));
    expect(note.style.visibility).toBe("visible");
  });
});
