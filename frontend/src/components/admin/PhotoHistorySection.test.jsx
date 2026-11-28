import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PhotoHistorySection from "./PhotoHistorySection.jsx";

vi.mock("../../api/client.js", () => ({ uploadPartnerImage: vi.fn(), deletePartnerPhoto: vi.fn() }));
vi.mock("../../hooks/useConfirmDialog.jsx", () => ({
  default: () => ({ confirm: vi.fn(), confirmElement: null }),
}));

const photos = [
  { id: "ph1", receivedDate: "2026-10-01T00:00:00.000Z", url: "/p1", rawUrl: "/p1/raw", fileName: "a.jpg" },
];

describe("PhotoHistorySection delete button", () => {
  it("is not shown unless the caller says the person may delete (admins only)", () => {
    render(<PhotoHistorySection partnerId="p" photos={photos} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
  it("is shown when the caller allows it", () => {
    render(<PhotoHistorySection partnerId="p" photos={photos} onChange={() => {}} canDelete />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});
