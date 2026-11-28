import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WebAddressInput from "./WebAddressInput.jsx";
import AddressFields from "../admin/AddressFields.jsx";

describe("WebAddressInput", () => {
  it("says nothing until you leave the box, then only for something that is not a web address", () => {
    render(<WebAddressInput aria-label="Link" value="javascript:alert(1)" onChange={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Link"));
    expect(screen.getByRole("status").textContent).toMatch(/web address/);
  });
  it("stays quiet for a bare address and for a blank box", () => {
    const { rerender } = render(
      <WebAddressInput aria-label="Link" value="example.org" onChange={() => {}} />
    );
    fireEvent.blur(screen.getByLabelText("Link"));
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<WebAddressInput aria-label="Link" value="" onChange={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("AddressFields street hint", () => {
  const value = { addressLine1: "Main Street" };
  it("appears on a mailing address that has no number or PO box", () => {
    render(<AddressFields value={value} onChange={() => {}} mailing />);
    fireEvent.blur(screen.getByLabelText(/^Address Line 1/));
    expect(screen.getByRole("status").textContent).toMatch(/street address or a PO box/);
  });
  it("never appears on a serving location, and not for a PO box", () => {
    const { rerender } = render(<AddressFields value={value} onChange={() => {}} />);
    fireEvent.blur(screen.getByLabelText(/^Address Line 1/));
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<AddressFields value={{ addressLine1: "PO Box 45" }} onChange={() => {}} mailing />);
    fireEvent.blur(screen.getByLabelText(/^Address Line 1/));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
