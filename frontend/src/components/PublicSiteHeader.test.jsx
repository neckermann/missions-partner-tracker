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
