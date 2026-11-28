import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotFound from "./NotFound.jsx";

vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ enabledFeatures: {}, partnerTermPlural: "Missionaries", logo: null }),
}));

const at = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("NotFound", () => {
  it("says the page wasn't found and offers the home page (the header carries team sign-in)", () => {
    at(<NotFound />);
    expect(screen.getByRole("heading", { name: "That page wasn't found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Team sign in" }).length).toBe(1);
  });

  it("inside the admin shell it is just the message and a way back to Home", () => {
    at(<NotFound inAdmin />);
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("link", { name: "Team sign in" })).toBeNull();
  });
});
