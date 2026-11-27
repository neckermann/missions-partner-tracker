import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsProvider } from "../../context/SettingsContext.jsx";
import PhoneInput from "./PhoneInput.jsx";
import { fetchPublicSettings } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({ fetchPublicSettings: vi.fn() }));

function Box() {
  const [value, setValue] = useState("");
  return (
    <SettingsProvider>
      <label>
        Phone
        <PhoneInput value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
    </SettingsProvider>
  );
}

describe("PhoneInput reads the church's country from settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shapes and accepts a local number in the church's country", async () => {
    fetchPublicSettings.mockResolvedValue({ defaultPhoneCountry: "GB" });
    render(<Box />);
    await waitFor(() => expect(fetchPublicSettings).toHaveBeenCalled());
    const box = screen.getByLabelText("Phone");
    await waitFor(() => {
      fireEvent.change(box, { target: { value: "" } });
      fireEvent.change(box, { target: { value: "02079460958" } });
      expect(box).toHaveValue("020 7946 0958");
    });
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is the United States when the church has not set one", async () => {
    fetchPublicSettings.mockResolvedValue({});
    render(<Box />);
    await waitFor(() => expect(fetchPublicSettings).toHaveBeenCalled());
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "5065550259" } });
    expect(box).toHaveValue("(506) 555-0259");
  });
});
