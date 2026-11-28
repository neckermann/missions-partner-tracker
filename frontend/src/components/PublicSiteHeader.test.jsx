import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PublicSiteHeader from "./PublicSiteHeader.jsx";

let settings;
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => settings }));

const base = { logo: null, partnerTermPlural: "Missionaries" };
const show = () =>
  render(
    <MemoryRouter initialEntries={["/map"]}>
      <PublicSiteHeader title="Map" />
    </MemoryRouter>
  );

describe("PublicSiteHeader's prayer sign-up link", () => {
  it("is there when the digest is on and sign-up can work", () => {
    settings = { ...base, enabledFeatures: { publicPrayerDigest: true }, publicSubscribeAvailable: true };
    show();
    expect(screen.getByRole("link", { name: /Pray for our Missionaries/ })).toBeInTheDocument();
  });

  it("is hidden when sign-up cannot work (no working email), instead of leading to 'Not found'", () => {
    settings = { ...base, enabledFeatures: { publicPrayerDigest: true }, publicSubscribeAvailable: false };
    show();
    expect(screen.queryByRole("link", { name: /Pray for our Missionaries/ })).toBeNull();
  });
});

describe("PublicSiteHeader's identity and sign-in", () => {
  it("names the church, and links team sign-in, on every public page", () => {
    settings = { ...base, churchName: "Hillside Community Church", enabledFeatures: {} };
    show();
    expect(screen.getByText("Hillside Community Church")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team sign in" })).toHaveAttribute("href", "/login");
  });

  it("shows no name line when the church hasn't set one", () => {
    settings = { ...base, churchName: null, enabledFeatures: {} };
    show();
    expect(document.querySelector(".header-church")).toBeNull();
  });
});
