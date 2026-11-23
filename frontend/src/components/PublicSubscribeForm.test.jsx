import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PublicSubscribeForm from "./PublicSubscribeForm.jsx";
import { fetchPublicPartners, subscribeToDigest } from "../api/client.js";

// The cadence picker on both forms this component backs -- the dedicated
// Subscribe page (picker=true) and a partner's own "follow this partner"
// form (picker=false) -- filtered to only the admin-enabled tiers (#209),
// with monthly preferred as the default pre-selected option. Unlike
// AccountSettings.jsx's own picker, there's no "already subscribed"
// exception to test here: every use of this form is a brand-new
// subscription.
vi.mock("../api/client.js", () => ({
  fetchPublicPartners: vi.fn(),
  subscribeToDigest: vi.fn(),
}));

let cadenceTiersEnabled;
vi.mock("../context/SettingsContext.jsx", () => ({
  useSettings: () => ({ cadenceTiersEnabled }),
}));

function cadenceSelect() {
  return screen.getByLabelText("How often");
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchPublicPartners.mockResolvedValue([]);
});

describe("PublicSubscribeForm -- cadence picker", () => {
  it("offers only the enabled tiers, defaulting to monthly", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
    render(<PublicSubscribeForm allPartners partnerIds={[]} />);

    const options = within(cadenceSelect())
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).toEqual(["monthly", "quarterly"]);
    expect(cadenceSelect().value).toBe("monthly");
  });

  it("falls back to quarterly when monthly is disabled too", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: false, quarterly: true };
    render(<PublicSubscribeForm allPartners partnerIds={[]} />);

    expect(cadenceSelect().value).toBe("quarterly");
    const options = within(cadenceSelect())
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).toEqual(["quarterly"]);
  });

  it("includes biweekly when the admin has enabled it, still preferring monthly as the default", async () => {
    cadenceTiersEnabled = { biweekly: true, monthly: true, quarterly: true };
    render(<PublicSubscribeForm allPartners partnerIds={[]} />);

    const options = within(cadenceSelect())
      .getAllByRole("option")
      .map((o) => o.value);
    expect(options).toEqual(["biweekly", "monthly", "quarterly"]);
    expect(cadenceSelect().value).toBe("monthly");
  });

  it("submits the picked (enabled) cadence on subscribe", async () => {
    cadenceTiersEnabled = { biweekly: false, monthly: true, quarterly: true };
    subscribeToDigest.mockResolvedValue({ message: "Check your email." });
    render(<PublicSubscribeForm allPartners partnerIds={[]} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@example.test" } });
    fireEvent.change(cadenceSelect(), { target: { value: "quarterly" } });
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));

    await waitFor(() =>
      expect(subscribeToDigest).toHaveBeenCalledWith(
        expect.objectContaining({ email: "a@example.test", cadence: "quarterly" })
      )
    );
  });
});
