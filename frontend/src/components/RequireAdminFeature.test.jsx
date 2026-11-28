import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RequireAdminFeature from "./RequireAdminFeature.jsx";
import useCurrentUser from "../hooks/useCurrentUser.js";

let features = {};
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => ({ enabledFeatures: features }) }));
vi.mock("../hooks/useCurrentUser.js", () => ({ default: vi.fn() }));

const gate = (feature) =>
  render(
    <MemoryRouter>
      <RequireAdminFeature feature={feature}>
        <p>the page</p>
      </RequireAdminFeature>
    </MemoryRouter>
  );

describe("RequireAdminFeature", () => {
  it("shows the page while the feature is on, or any of several is", () => {
    useCurrentUser.mockReturnValue({ isGuest: false, loading: false });
    features = { groupme: true };
    gate("groupme");
    expect(screen.getByText("the page")).toBeInTheDocument();
    features = { inboundEmail: true };
    gate(["outboundEmail", "inboundEmail"]);
    expect(screen.getAllByText("the page").length).toBe(2);
  });

  it("explains, with a link to the page that really exists, when it is off", () => {
    useCurrentUser.mockReturnValue({ isGuest: false, loading: false });
    features = { groupme: false };
    gate("groupme");
    expect(screen.queryByText("the page")).toBeNull();
    const link = screen.getByRole("link", { name: /Enabled Features/ });
    expect(link).toHaveAttribute("href", "/admin/settings/features");
    expect(document.body.textContent).not.toMatch(/Church Settings/);
  });
});
