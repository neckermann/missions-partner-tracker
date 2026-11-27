import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PublicSubscribe from "./PublicSubscribe.jsx";

// The page ships no Scripture of its own (#508): a passage shows only when the church has set one, in the
// translation it chose.
let settings;
vi.mock("../context/SettingsContext.jsx", () => ({ useSettings: () => settings }));
vi.mock("../components/DemoBanner.jsx", () => ({ default: () => null }));
vi.mock("../components/PublicSiteHeader.jsx", () => ({ default: ({ title }) => <h1>{title}</h1> }));
vi.mock("../components/PublicSubscribeForm.jsx", () => ({ default: () => <form aria-label="subscribe" /> }));

const renderIt = () =>
  render(
    <MemoryRouter>
      <PublicSubscribe />
    </MemoryRouter>
  );

beforeEach(() => {
  settings = { partnerTermPlural: "Missionaries", subscribePassage: null, subscribePassageSource: null };
});

describe("PublicSubscribe", () => {
  it("shows no passage when the church has not set one", () => {
    renderIt();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
    expect(document.querySelector(".scripture-quote")).toBeNull();
    expect(screen.queryByText(/Ephesians/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("subscribe")).toBeInTheDocument();
  });

  it("shows the church's passage and where it is from", () => {
    settings.subscribePassage = "Pray without ceasing.";
    settings.subscribePassageSource = "1 Thessalonians 5:17 (NIV)";
    renderIt();
    expect(screen.getByText("Pray without ceasing.")).toBeInTheDocument();
    expect(screen.getByText(/1 Thessalonians 5:17 \(NIV\)/)).toBeInTheDocument();
  });

  it("shows the passage alone when no source is given", () => {
    settings.subscribePassage = "Pray without ceasing.";
    renderIt();
    expect(screen.getByText("Pray without ceasing.")).toBeInTheDocument();
    expect(document.querySelector("cite")).toBeNull();
  });
});
