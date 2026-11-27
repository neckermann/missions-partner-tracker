import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmailInput, { emailHint } from "./EmailInput.jsx";

function Box({ initial = "", ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <label>
      Email
      <EmailInput value={value} onChange={(e) => setValue(e.target.value)} {...rest} />
    </label>
  );
}

describe("EmailInput", () => {
  it("is an email box and passes its other props to the input", () => {
    render(<Box required maxLength={200} name="email" />);
    const box = screen.getByLabelText("Email");
    expect(box).toHaveAttribute("type", "email");
    expect(box).toHaveAttribute("inputmode", "email");
    expect(box).toHaveAttribute("autocomplete", "email");
    expect(box).toBeRequired();
    expect(box).toHaveAttribute("maxlength", "200");
    expect(box).toHaveAttribute("name", "email");
  });

  it("does not reshape what is typed", () => {
    render(<Box />);
    const box = screen.getByLabelText("Email");
    fireEvent.change(box, { target: { value: "Sam@Example.ORG" } });
    expect(box).toHaveValue("Sam@Example.ORG");
  });

  it("says nothing until the box is left, then explains an address that can't be one", () => {
    render(<Box />);
    const box = screen.getByLabelText("Email");
    fireEvent.change(box, { target: { value: "not an email" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.blur(box);
    expect(screen.getByRole("status")).toHaveTextContent("That doesn't look like an email address.");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("That doesn't look like an email address.");
  });

  it("clears the note once it is fixed, and is quiet for blank and good addresses", () => {
    render(<Box />);
    const box = screen.getByLabelText("Email");
    fireEvent.change(box, { target: { value: "nope" } });
    fireEvent.blur(box);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "sam@example.org" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("emailHint", () => {
  it("matches the server's rule", () => {
    expect(emailHint("")).toBe("");
    expect(emailHint("  Sam.Doe@Example.ORG ")).toBe("");
    for (const bad of ["nope", "a@b", "a b@c.org", "@c.org", "a@@c.org", `${"x".repeat(200)}@c.org`]) {
      expect(emailHint(bad), bad).toMatch(/email address/);
    }
  });
});
