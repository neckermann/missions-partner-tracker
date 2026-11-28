import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SignatureCapture from "./SignatureCapture.jsx";

describe("SignatureCapture", () => {
  it("lets an adult choose to sign as themselves or as a parent or guardian", () => {
    render(<SignatureCapture documentText="I agree." onSubmit={() => {}} />);
    expect(screen.getByLabelText(/I am signing as/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Myself" })).toBeTruthy();
  });

  it("offers only a parent or guardian for someone under 18", () => {
    render(<SignatureCapture documentText="I agree." onSubmit={() => {}} isMinor />);
    expect(screen.queryByLabelText(/I am signing as/)).toBeNull();
    expect(screen.queryByRole("option", { name: "Myself" })).toBeNull();
    expect(screen.getByText(/parent or legal guardian/)).toBeTruthy();
    expect(screen.getByLabelText(/Parent\/guardian's full name/)).toBeTruthy();
  });
});
