import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhoneField from "./PhoneField.jsx";
import { phoneHint } from "./PhoneInput.jsx";

function Box({ onSeen, initial = "", ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneField
      label="Phone"
      value={value}
      onChange={(e) => {
        onSeen?.(e.target.value);
        setValue(e.target.value);
      }}
      {...rest}
    />
  );
}

const picker = () => screen.getByLabelText("Country for this phone number");

describe("PhoneField", () => {
  it("is labelled by its label, with the country picker named separately", () => {
    render(<Box required maxLength={40} name="phone1" />);
    const box = screen.getByLabelText("Phone");
    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveAttribute("type", "tel");
    expect(box).toHaveAttribute("inputmode", "tel");
    expect(box).toBeRequired();
    expect(box).toHaveAttribute("maxlength", "40");
    expect(box).toHaveAttribute("name", "phone1");
    expect(picker().tagName).toBe("SELECT");
    expect(screen.getByLabelText("Phone")).not.toBe(picker());
    expect(screen.getByText("Phone").tagName).toBe("LABEL");
  });

  it("shapes the digits as they are typed and passes on the international number", () => {
    const seen = vi.fn();
    render(<Box onSeen={seen} />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "5065550259" } });
    expect(box).toHaveValue("(506) 555-0259");
    expect(seen).toHaveBeenLastCalledWith("+15065550259");
  });

  it("passes on the shaped text until the number is a complete one", () => {
    const seen = vi.fn();
    render(<Box onSeen={seen} />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555" } });
    expect(seen).toHaveBeenLastCalledWith("(555)");
  });

  it("starts on the church's country, and a local number is read in it", () => {
    const seen = vi.fn();
    render(<Box country="GB" onSeen={seen} />);
    expect(picker()).toHaveValue("GB");
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "02079460958" } });
    expect(box).toHaveValue("020 7946 0958");
    expect(seen).toHaveBeenLastCalledWith("+442079460958");
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("lets you pick another country and type the number the way people there write it", () => {
    const seen = vi.fn();
    render(<Box onSeen={seen} />);
    expect(picker()).toHaveValue("US");
    fireEvent.change(picker(), { target: { value: "KE" } });
    expect(picker()).toHaveValue("KE");
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "0712345678" } });
    expect(box).toHaveValue("0712 345678");
    expect(seen).toHaveBeenLastCalledWith("+254712345678");
  });

  it("switches the picker to the country of a number typed with its own +", () => {
    const seen = vi.fn();
    render(<Box onSeen={seen} />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "+442079460958" } });
    expect(box).toHaveValue("+44 20 7946 0958");
    expect(picker()).toHaveValue("GB");
    expect(seen).toHaveBeenLastCalledWith("+442079460958");
  });

  it("shows a saved number in its own country: the picker and the local way of writing it", () => {
    render(<Box initial="+254712345678" />);
    expect(picker()).toHaveValue("KE");
    expect(screen.getByLabelText("Phone")).toHaveValue("0712 345678");
  });

  it("keeps a North American saved number in the usual (AAA) EEE-NNNN form", () => {
    render(<Box initial="+15065550259" />);
    expect(picker()).toHaveValue("US");
    expect(screen.getByLabelText("Phone")).toHaveValue("(506) 555-0259");
  });

  it("follows a value that changes from outside, such as a form reset", () => {
    const { rerender } = render(<PhoneField label="Phone" value="+15065550259" onChange={() => {}} />);
    expect(screen.getByLabelText("Phone")).toHaveValue("(506) 555-0259");
    rerender(<PhoneField label="Phone" value="+442079460958" onChange={() => {}} />);
    expect(picker()).toHaveValue("GB");
    expect(screen.getByLabelText("Phone")).toHaveValue("020 7946 0958");
    rerender(<PhoneField label="Phone" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Phone")).toHaveValue("");
  });

  it("changing the country of a number that has its own + keeps its digits", () => {
    const seen = vi.fn();
    render(<Box initial="+442079460958" onSeen={seen} />);
    fireEvent.change(picker(), { target: { value: "US" } });
    expect(screen.getByLabelText("Phone")).toHaveValue("(207) 946-0958");
    expect(seen).toHaveBeenLastCalledWith("+12079460958");
  });

  it("leaves what is typed alone when deleting, so the cursor never jumps", () => {
    render(<Box initial="+15065550259" />);
    const box = screen.getByLabelText("Phone");
    fireEvent.input(box, { target: { value: "(506) 555-025" }, inputType: "deleteContentBackward" });
    expect(box).toHaveValue("(506) 555-025");
  });

  it("really distinguishes deleting from typing: the same text is reshaped only when typed", () => {
    const { unmount } = render(<Box />);
    const typed = screen.getByLabelText("Phone");
    fireEvent.input(typed, { target: { value: "(506) " }, inputType: "insertText" });
    expect(typed).toHaveValue("(506)");
    unmount();
    render(<Box />);
    const deleted = screen.getByLabelText("Phone");
    fireEvent.input(deleted, { target: { value: "(506) " }, inputType: "deleteContentBackward" });
    expect(deleted).toHaveValue("(506) ");
  });

  it("clears to empty when the box is emptied", () => {
    const seen = vi.fn();
    render(<Box initial="+15065550259" onSeen={seen} />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "" } });
    expect(screen.getByLabelText("Phone")).toHaveValue("");
    expect(seen).toHaveBeenLastCalledWith("");
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

  it("clears the note once the number is fixed, and is quiet for a blank box", () => {
    render(<Box />);
    const box = screen.getByLabelText("Phone");
    fireEvent.change(box, { target: { value: "12" } });
    fireEvent.blur(box);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "5065550259" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("passes the field's name along with the value so a shared handler still works", () => {
    const seen = vi.fn();
    render(
      <PhoneField
        label="Phone"
        name="phone1"
        value=""
        onChange={(e) => seen(e.target.name, e.target.value)}
      />
    );
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "3375550100" } });
    expect(seen).toHaveBeenCalledWith("phone1", "+13375550100");
  });

  it("disables the picker with the box", () => {
    render(<Box disabled />);
    expect(screen.getByLabelText("Phone")).toBeDisabled();
    expect(picker()).toBeDisabled();
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
