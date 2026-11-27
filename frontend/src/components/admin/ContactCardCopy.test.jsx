import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContactCard from "./ContactCard.jsx";
import CopyValue from "../shared/CopyValue.jsx";

// Copy buttons next to a phone and an email: the right form is copied, a click never reaches the clickable card or
// row behind it, and a way the church said not to use is never copied.
vi.mock("../../api/client.js", () => ({ updateAdult: vi.fn(), updatePartner: vi.fn() }));

const writeText = vi.fn().mockResolvedValue();
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText } });
});

const adults = [
  {
    id: "a1",
    firstName: "Dana",
    lastName: "Reed",
    phone1: "+15065550259",
    email: "dana@x.org",
    isPrimaryContact: true,
  },
];
const base = { id: "p1", kind: "missionary", contactLevel: "normal" };

describe("CopyValue", () => {
  it("copies a phone in international form and says what it copied", async () => {
    render(<CopyValue kind="phone" value="(506) 555-0259" whose="Pat" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Pat's phone number" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("+15065550259"));
    expect(await screen.findByRole("button", { name: "Copied +15065550259" })).toBeTruthy();
  });

  it("copies an email as saved, and shows nothing for a blank value", () => {
    const { container, rerender } = render(<CopyValue kind="email" value="pat@x.org" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy email address" }));
    expect(writeText).toHaveBeenCalledWith("pat@x.org");
    rerender(<CopyValue kind="email" value="" />);
    expect(container.textContent).toBe("");
  });

  it("keeps its click and key presses from reaching a clickable parent", () => {
    const parentClick = vi.fn();
    const parentKey = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onClick={parentClick} onKeyDown={parentKey}>
        <CopyValue kind="phone" value="+15065550259" />
      </div>
    );
    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
  });
});

describe("ContactCard copy buttons", () => {
  it("offers phone and email copy buttons, and a click does not open the edit form", () => {
    render(<ContactCard partner={base} adults={adults} entries={[]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Dana's phone number" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Dana's email address" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writeText).toHaveBeenCalledWith("+15065550259");
    expect(writeText).toHaveBeenCalledWith("dana@x.org");
  });

  it("copies nothing the card hides: a partner not to be contacted directly shows no copy button for them", () => {
    const partner = { ...base, contactLevel: "no_direct", contactInstructions: "Ask staff." };
    render(<ContactCard partner={partner} adults={adults} entries={[]} />);
    expect(screen.queryByRole("button", { name: /Copy Dana/ })).toBeNull();
  });

  it("still offers the go-between's number, which the card shows on purpose", () => {
    const partner = {
      ...base,
      contactLevel: "no_direct",
      contactViaName: "Pastor Lee",
      contactViaPhone: "+15065550111",
    };
    render(<ContactCard partner={partner} adults={adults} entries={[]} />);
    expect(screen.getByRole("button", { name: "Copy Pastor Lee's phone number" })).toBeTruthy();
  });

  it("under caution, a way that is not ticked is not copyable", () => {
    const partner = { ...base, contactLevel: "caution", contactChannels: ["email"] };
    render(<ContactCard partner={partner} adults={adults} entries={[]} />);
    expect(screen.getByRole("button", { name: "Copy Dana's email address" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy Dana's phone number" })).toBeNull();
  });
});
