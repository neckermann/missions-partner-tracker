import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsProvider } from "../../context/SettingsContext.jsx";
import PhoneField from "./PhoneField.jsx";
import { fetchPublicSettings } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({ fetchPublicSettings: vi.fn() }));

function Box({ onSeen }) {
  const [value, setValue] = useState("");
  return (
    <SettingsProvider>
      <PhoneField
        label="Phone"
        value={value}
        onChange={(e) => {
          onSeen?.(e.target.value);
          setValue(e.target.value);
        }}
      />
    </SettingsProvider>
  );
}

const picker = () => screen.getByLabelText("Country for this phone number");

describe("the phone field reads the church's country from settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts on that country once settings arrive, and reads a local number in it", async () => {
    fetchPublicSettings.mockResolvedValue({ defaultPhoneCountry: "GB" });
    const seen = vi.fn();
    render(<Box onSeen={seen} />);
    await waitFor(() => expect(picker()).toHaveValue("GB"));
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "02079460958" } });
    expect(box).toHaveValue("020 7946 0958");
    expect(seen).toHaveBeenLastCalledWith("+442079460958");
  });

  it("is the United States when the church has not set one", async () => {
    fetchPublicSettings.mockResolvedValue({});
    render(<Box />);
    await waitFor(() => expect(fetchPublicSettings).toHaveBeenCalled());
    expect(picker()).toHaveValue("US");
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "5065550259" } });
    expect(box).toHaveValue("(506) 555-0259");
  });

  it("does not move a picker someone has already chosen when settings arrive", async () => {
    let resolve;
    fetchPublicSettings.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Box />);
    fireEvent.change(picker(), { target: { value: "KE" } });
    resolve({ defaultPhoneCountry: "GB" });
    await waitFor(() => expect(fetchPublicSettings).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(picker()).toHaveValue("KE");
  });
});
