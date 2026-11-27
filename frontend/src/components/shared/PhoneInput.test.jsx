import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhoneInput, { phoneHint } from "./PhoneInput.jsx";

function Box({ onSeen, initial = "", ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <label>
      Phone
      <PhoneInput
        value={value}
        onChange={(e) => {
          onSeen?.(e.target.value);
          setValue(e.target.value);
        }}
        {...rest}
      />
    </label>
  );
}

describe("PhoneInput", () => {
  it("shapes the digits as they are typed at the end of the box", () => {
    const seen = vi.fn();
    render(<Box onSeen={seen} />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "5065550259" } });
    expect(seen).toHaveBeenLastCalledWith("(506) 555-0259");
    expect(box).toHaveValue("(506) 555-0259");
  });

  it("shapes an international number once it starts with +", () => {
    render(<Box />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "+442079460958" } });
    expect(box).toHaveValue("+44 20 7946 0958");
    fireEvent.change(box, { target: { value: "+254712345678" } });
    expect(box).toHaveValue("+254 712 345678");
  });

  it("reads a number with no + in the church's country when one is given", () => {
    render(<Box country="GB" />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "02079460958" } });
    expect(box).toHaveValue("020 7946 0958");
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("leaves what is typed alone when deleting, so the cursor never jumps", () => {
    render(<Box initial="(506) 555-0259" />);
    const box = screen.getByLabelText("Phone");
    fireEvent.input(box, { target: { value: "(506) 555-025" }, inputType: "deleteContentBackward" });
    expect(box).toHaveValue("(506) 555-025");
    fireEvent.input(box, { target: { value: "(506) 555-02" }, inputType: "deleteContentBackward" });
    expect(box).toHaveValue("(506) 555-02");
  });

  it("really distinguishes deleting from typing: the same text is reshaped only when typed", () => {
    const { unmount } = render(<Box />);
    const typed = screen.getByLabelText("Phone");
    // Typing "(506) " reshapes it (the trailing space is dropped) ...
    fireEvent.input(typed, { target: { value: "(506) " }, inputType: "insertText" });
    expect(typed).toHaveValue("(506)");
    unmount();
    // ... deleting back to the very same text leaves it exactly as it is.
    render(<Box />);
    const deleted = screen.getByLabelText("Phone");
    fireEvent.input(deleted, { target: { value: "(506) " }, inputType: "deleteContentBackward" });
    expect(deleted).toHaveValue("(506) ");
  });

  it("clears to empty when the box is emptied", () => {
    render(<Box initial="(506) 555-0259" />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "" } });
    expect(box).toHaveValue("");
  });

  it("says nothing until the box is left, then explains a number that can't be one", () => {
    render(<Box />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "555-0100" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(box);
    expect(screen.getByRole("status")).toHaveTextContent(
      /doesn't look like a phone number\. Include the area code/
    );
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/Include the area code/);
  });

  it("clears the note once the number is fixed", () => {
    render(<Box />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "12" } });
    fireEvent.blur(box);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "5065550259" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid");
  });

  it("is quiet for a blank box and for a good number, and never blocks anything", () => {
    render(<Box initial="(506) 555-0259" />);
    const box = screen.getByLabelText("Phone");
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is a phone box and passes its other props to the input", () => {
    render(<Box required maxLength={40} autoComplete="off" name="phone1" />);
    const box = screen.getByLabelText("Phone");
    expect(box).toHaveAttribute("type", "tel");
    expect(box).toHaveAttribute("inputmode", "tel");
    expect(box).toBeRequired();
    expect(box).toHaveAttribute("maxlength", "40");
    expect(box).toHaveAttribute("autocomplete", "off");
    expect(box).toHaveAttribute("name", "phone1");
  });

  it("passes a name along with the shaped value so a shared handler still works", () => {
    const seen = vi.fn();
    render(<PhoneInput name="phone1" value="" onChange={(e) => seen(e.target.name, e.target.value)} />);
    fireEvent.change(document.querySelector("input"), { target: { value: "3375550100" } });
    expect(seen).toHaveBeenCalledWith("phone1", "(337) 555-0100");
  });
});

describe("phoneHint", () => {
  it("is empty for blank and for numbers that can be real, including fictional 555 ones", () => {
    expect(phoneHint("")).toBe("");
    expect(phoneHint("   ")).toBe("");
    expect(phoneHint("(506) 555-0259")).toBe("");
    expect(phoneHint("(555) 123-4567")).toBe("");
    expect(phoneHint("+44 20 7946 0958")).toBe("");
    expect(phoneHint("020 7946 0958", "GB")).toBe("");
  });

  it("explains letters, too-short numbers and a missing area code in plain words", () => {
    expect(phoneHint("dsafdsfsadf")).toMatch(/doesn't look like a phone number/);
    expect(phoneHint("12345")).toMatch(/Include the area code/);
    expect(phoneHint("555-0100")).toMatch(/Include the area code/);
  });

  it("says something different for a + number that is incomplete", () => {
    expect(phoneHint("+44 12")).toMatch(/complete number for that country/);
  });
});
