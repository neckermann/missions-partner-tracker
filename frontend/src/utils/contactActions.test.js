import { describe, it, expect } from "vitest";
import { contactActions, primaryContactOf, whatsappDigits } from "./contactActions.js";

describe("contactActions", () => {
  it("builds call, text, email and WhatsApp links from what's on file", () => {
    const keys = contactActions({ phone: "(555) 123-4567", email: "a@b.org" }).map((a) => a.key);
    expect(keys).toEqual(["call", "text", "email", "whatsapp"]);
    const call = contactActions({ phone: "(555) 123-4567" }).find((a) => a.key === "call");
    expect(call.href).toBe("tel:5551234567");
  });

  it("keeps a leading + for international numbers and never invents a country code for them", () => {
    expect(contactActions({ phone: "+502 5555 1234" }).find((a) => a.key === "call").href).toBe(
      "tel:+50255551234"
    );
    expect(whatsappDigits("+502 5555 1234")).toBe("50255551234");
  });

  it("assumes a bare 10-digit number is US/Canada for WhatsApp only", () => {
    expect(whatsappDigits("555-123-4567")).toBe("15551234567");
    expect(whatsappDigits("55551234")).toBe("55551234");
  });

  it("offers nothing for missing or junk values", () => {
    expect(contactActions({})).toEqual([]);
    expect(contactActions({ phone: "12", email: "not an email" })).toEqual([]);
  });
});

describe("primaryContactOf", () => {
  const adults = [
    { firstName: "Ann", lastName: "A", phone1: "111", email: "ann@x.org", isPrimaryContact: false },
    { firstName: "Bob", lastName: "B", phone1: null, phone2: "5551234567", isPrimaryContact: true },
  ];
  it("prefers the flagged adult, then the first", () => {
    expect(primaryContactOf({ kind: "missionary" }, adults)).toMatchObject({
      name: "Bob B",
      isPrimary: true,
      phone: "5551234567",
    });
    expect(primaryContactOf({ kind: "missionary" }, [adults[0]])).toMatchObject({
      name: "Ann A",
      isPrimary: false,
    });
    expect(primaryContactOf({ kind: "missionary" }, [])).toBeNull();
  });
  it("uses an organization's named contact", () => {
    const org = {
      kind: "organization",
      contactFirstName: "Pat",
      contactLastName: "Lee",
      contactEmail: "p@org.org",
    };
    expect(primaryContactOf(org, [])).toMatchObject({ name: "Pat Lee", email: "p@org.org" });
    expect(primaryContactOf({ kind: "organization" }, [])).toBeNull();
  });
});
