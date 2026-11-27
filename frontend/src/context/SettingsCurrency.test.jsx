import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SettingsProvider } from "./SettingsContext.jsx";
import { formatCurrency, currencySymbol, setChurchCurrency } from "../utils/format.js";
import { fetchPublicSettings } from "../api/client.js";

// The settings carry the church's currency to every formatter, and an app already on screen is rebuilt when
// it arrives, so a label written by a plain function does not stay in dollars.
vi.mock("../api/client.js", () => ({ fetchPublicSettings: vi.fn() }));

function Money() {
  return (
    <p>
      {formatCurrency(1200)} / {currencySymbol()}
    </p>
  );
}

beforeEach(() => {
  setChurchCurrency("USD");
  fetchPublicSettings.mockReset();
});

describe("SettingsProvider currency", () => {
  it("writes amounts in dollars when the church has not changed it", async () => {
    fetchPublicSettings.mockResolvedValue({ currency: "USD" });
    render(
      <SettingsProvider>
        <Money />
      </SettingsProvider>
    );
    await waitFor(() => expect(fetchPublicSettings).toHaveBeenCalled());
    expect(await screen.findByText("$1,200 / $")).toBeInTheDocument();
  });

  it("switches what is already on screen to the church's currency once the settings arrive", async () => {
    fetchPublicSettings.mockResolvedValue({ currency: "EUR" });
    render(
      <SettingsProvider>
        <Money />
      </SettingsProvider>
    );
    expect(await screen.findByText("€1,200 / €")).toBeInTheDocument();
  });
});
