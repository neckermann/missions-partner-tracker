import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContactCard from "./ContactCard.jsx";
import { updateAdult, updatePartner } from "../../api/client.js";
import { todayInputValue } from "../../utils/format.js";

vi.mock("../../api/client.js", () => ({ updateAdult: vi.fn(), updatePartner: vi.fn() }));

const adults = [
  {
    id: "a1",
    firstName: "Dana",
    lastName: "Reed",
    phone1: "(555) 123-4567",
    email: "dana@x.org",
    isPrimaryContact: true,
    contactMethod: "whatsapp",
  },
  { id: "a2", firstName: "Sam", lastName: "Reed", contactMethod: "other", contactMethodNote: "Telegram" },
];
const base = { id: "p1", kind: "missionary", contactLevel: "normal" };

beforeEach(() => vi.clearAllMocks());

describe("ContactCard (#288)", () => {
  it("shows the primary contact, how they like to be reached, and the tap actions", () => {
    render(<ContactCard partner={base} adults={adults} entries={[]} />);
    expect(screen.getByText("Dana Reed")).toBeTruthy();
    expect(screen.getByText(/primary contact/)).toBeTruthy();
    expect(screen.getByText("WhatsApp", { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:5551234567");
    expect(screen.getByRole("link", { name: "Email" }).getAttribute("href")).toBe("mailto:dana@x.org");
    expect(screen.getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe(
      "https://wa.me/15551234567"
    );
    // Someone else in the family, and how they like to be reached.
    expect(screen.getByText(/Sam Reed prefers Telegram/)).toBeTruthy();
  });

  it("an organization's contact carries its own way to be reached", () => {
    const org = {
      id: "o1",
      kind: "organization",
      contactFirstName: "Olive",
      contactEmail: "olive@org.example",
      contactMethod: "email",
    };
    render(<ContactCard partner={org} adults={[]} entries={[]} />);
    expect(screen.getByText("Olive")).toBeTruthy();
    expect(screen.getByText("Email", { selector: "strong" })).toBeTruthy();
  });

  it("use caution: keeps the details under a warning, and only the ways it names", () => {
    const partner = {
      ...base,
      contactLevel: "caution",
      contactChannels: ["email"],
      contactInstructions: "Please don't say 'mission' in the subject.",
    };
    render(<ContactCard partner={partner} adults={adults} entries={[]} />);
    expect(screen.getByText("Use caution")).toBeTruthy();
    expect(screen.getByText(/Reach them by email only/)).toBeTruthy();
    expect(screen.getByText(/don't say 'mission'/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Email" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
    expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
    expect(screen.getByText(/dana@x.org/)).toBeTruthy();
  });

  it("don't contact directly: hides their details and says who to go through", () => {
    const partner = {
      ...base,
      contactLevel: "no_direct",
      contactInstructions: "Email the office. Never call.",
      contactViaName: "Mission office",
      contactViaRole: "Sending organization",
      contactViaPhone: "555-0100",
      contactViaEmail: "office@org.example",
    };
    render(<ContactCard partner={partner} adults={adults} entries={[]} />);
    expect(screen.getByText("Don't contact directly")).toBeTruthy();
    expect(screen.getByText("Email the office. Never call.")).toBeTruthy();
    expect(screen.getByText("Mission office")).toBeTruthy();
    // Tap actions are for the go-between only.
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:5550100");
    expect(screen.getByRole("link", { name: "Email" }).getAttribute("href")).toBe(
      "mailto:office@org.example"
    );
    expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
    expect(screen.queryByText(/555\) 123-4567/)).toBeNull();
    expect(screen.queryByText(/dana@x.org/)).toBeNull();
    expect(screen.queryByText(/Prefers/)).toBeNull();
  });

  it("falls back to a safe default when no instructions were written", () => {
    render(<ContactCard partner={{ ...base, contactLevel: "no_direct" }} adults={adults} entries={[]} />);
    expect(screen.getByText(/Ask staff before reaching out/)).toBeTruthy();
  });

  it("says when anyone was last in touch, and leaves that out when the contact log is off", () => {
    const ymd = todayInputValue(new Date(Date.now() - 3 * 86400000));
    const { rerender } = render(
      <ContactCard partner={base} adults={adults} entries={[{ id: "e", contactDate: ymd }]} />
    );
    expect(screen.getByText(/Last contact: 3 days ago/)).toBeTruthy();
    rerender(<ContactCard partner={base} adults={adults} entries={[]} showLog={false} />);
    expect(screen.queryByText(/Last contact|No contact logged/)).toBeNull();
  });

  it("handles no contact person and no log", () => {
    render(<ContactCard partner={{ kind: "missionary", contactLevel: "normal" }} adults={[]} entries={[]} />);
    expect(screen.getByText(/No contact person on file/)).toBeTruthy();
    expect(screen.getByText(/No contact logged yet/)).toBeTruthy();
  });

  it("clicking the care team line does not also open Edit contact", () => {
    const onTeam = vi.fn();
    render(
      <ContactCard
        partner={base}
        adults={adults}
        entries={[]}
        canEdit
        careTeam={
          // Plain text with its own click, like the real line: not a button, so the card used to treat
          // a click on it as empty space and open Edit contact as well.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          <div onClick={onTeam}>Pat Lead (lead)</div>
        }
      />
    );
    fireEvent.click(screen.getByText("Pat Lead (lead)"));
    expect(onTeam).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the contact and care team zones separate: the contact zone still opens Edit contact", () => {
    render(
      <ContactCard
        partner={base}
        adults={adults}
        entries={[]}
        canEdit
        careTeam={<div>Pat Lead (lead)</div>}
      />
    );
    const team = screen.getByText("Pat Lead (lead)");
    expect(team.closest(".contact-care-team")).not.toBeNull();
    expect(team.closest(".contact-zone")).toBeNull();
    fireEvent.click(screen.getByText(/No contact logged yet|No contact person on file yet/));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("has no Edit button unless the person can edit", () => {
    render(<ContactCard partner={base} adults={adults} entries={[]} />);
    expect(screen.queryByRole("button", { name: "Edit contact" })).toBeNull();
  });
});

describe("ContactCard editing", () => {
  const open = (props = {}) => {
    const onChanged = vi.fn();
    render(
      <ContactCard
        partner={base}
        adults={adults}
        entries={[]}
        canEdit
        canEditCare
        onChanged={onChanged}
        {...props}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    return onChanged;
  };

  it("picks who to reach first and how they like to be reached", async () => {
    updateAdult.mockResolvedValue({});
    updatePartner.mockResolvedValue({});
    const onChanged = open();
    fireEvent.change(screen.getByLabelText("Reach first"), { target: { value: "a2" } });
    // Sam's own way to be reached shows up once picked.
    expect(screen.getByLabelText("Which way?").value).toBe("Telegram");
    fireEvent.change(screen.getByLabelText("How they like to be reached"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updateAdult).toHaveBeenCalledWith("a2", {
      isPrimaryContact: true,
      contactMethod: "email",
      contactMethodNote: null,
    });
  });

  it("sets caution with the ways it is ok to reach them, and the guidelines", async () => {
    updateAdult.mockResolvedValue({});
    updatePartner.mockResolvedValue({});
    const onChanged = open();
    fireEvent.click(screen.getByRole("radio", { name: /Use caution/ }));
    fireEvent.click(screen.getByLabelText("Email"));
    fireEvent.change(screen.getByLabelText(/^Guidelines/), { target: { value: "No exclamation marks." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updatePartner).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        contactLevel: "caution",
        contactChannels: ["email"],
        contactInstructions: "No exclamation marks.",
        contactViaName: null,
      })
    );
  });

  it("sets don't contact directly with who to go through", async () => {
    updateAdult.mockResolvedValue({});
    updatePartner.mockResolvedValue({});
    const onChanged = open();
    fireEvent.click(screen.getByRole("radio", { name: /Don't contact directly/ }));
    fireEvent.change(screen.getByLabelText("Go through (name)"), { target: { value: "Mission office" } });
    fireEvent.change(screen.getByLabelText("Their email"), { target: { value: "office@org.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updatePartner).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        contactLevel: "no_direct",
        contactChannels: [],
        contactViaName: "Mission office",
        contactViaEmail: "office@org.example",
      })
    );
  });

  it("someone who can't change how careful to be only sees who and how", () => {
    open({ canEditCare: false });
    expect(screen.getByLabelText("How they like to be reached")).toBeTruthy();
    expect(screen.queryByText("How careful to be")).toBeNull();
  });

  it("an organization's way to be reached is saved on the partner itself", async () => {
    updatePartner.mockResolvedValue({});
    const org = { id: "o1", kind: "organization", contactFirstName: "Olive" };
    const onChanged = open({ partner: org, adults: [] });
    fireEvent.change(screen.getByLabelText("How they like to be reached"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updatePartner).toHaveBeenCalledWith("o1", { contactMethod: "email", contactMethodNote: null });
    expect(updateAdult).not.toHaveBeenCalled();
  });

  it("shows a friendly error and stays open when a save fails", async () => {
    updateAdult.mockRejectedValue({ response: { data: { error: "Nope" } } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("ContactCard: not this season (C8)", () => {
  // A yyyy-mm-dd string n days from today, worked out from the same string the card compares against.
  const future = (n) => {
    const [y, m, d] = todayInputValue().split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };

  it("says so while the snooze is still ahead", () => {
    render(
      <ContactCard partner={{ ...base, contactSnoozedUntil: future(20) }} adults={adults} entries={[]} />
    );
    expect(screen.getByText(/Not this season: not called quiet until/)).toBeTruthy();
  });

  it("says nothing once the date has passed, or when there is none", () => {
    const { rerender } = render(
      <ContactCard partner={{ ...base, contactSnoozedUntil: future(-3) }} adults={adults} entries={[]} />
    );
    expect(screen.queryByText(/Not this season/)).toBeNull();
    rerender(<ContactCard partner={base} adults={adults} entries={[]} />);
    expect(screen.queryByText(/Not this season/)).toBeNull();
  });

  it("saves a snooze date from Edit contact, and clears it with a blank", async () => {
    updatePartner.mockResolvedValue({});
    updateAdult.mockResolvedValue({});
    const date = future(40);
    const { unmount } = render(<ContactCard partner={base} adults={adults} entries={[]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(screen.getByLabelText(/Don't call them quiet until/), { target: { value: date } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updatePartner).toHaveBeenCalledWith("p1", { contactSnoozedUntil: date }));
    unmount();

    updatePartner.mockClear();
    render(
      <ContactCard partner={{ ...base, contactSnoozedUntil: date }} adults={adults} entries={[]} canEdit />
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.change(screen.getByLabelText(/Don't call them quiet until/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updatePartner).toHaveBeenCalledWith("p1", { contactSnoozedUntil: null }));
  });

  it("does not touch the snooze when it was not changed", async () => {
    updatePartner.mockResolvedValue({});
    updateAdult.mockResolvedValue({});
    render(<ContactCard partner={base} adults={adults} entries={[]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAdult).toHaveBeenCalled());
    expect(updatePartner).not.toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ contactSnoozedUntil: expect.anything() })
    );
  });
});
