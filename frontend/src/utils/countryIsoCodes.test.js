import { describe, it, expect } from "vitest";
import { getCountries } from "libphonenumber-js/min";
import { isoCountryCode } from "./countryIsoCodes.js";
import { COUNTRY_CONTINENTS } from "./countryContinents.js";
import { getFipsCode } from "./countryFipsCodes.js";

describe("isoCountryCode", () => {
  it("gives the ISO code, which is not the FIPS code", () => {
    expect(isoCountryCode("Kenya")).toBe("KE");
    expect(isoCountryCode("Philippines")).toBe("PH");
    expect(getFipsCode("Philippines")).toBe("RP");
    expect(isoCountryCode("Japan")).toBe("JP");
    expect(isoCountryCode("Zambia")).toBe("ZM");
  });

  it("reads the names people type", () => {
    expect(isoCountryCode(" kenya ")).toBe("KE");
    expect(isoCountryCode("USA")).toBe("US");
    expect(isoCountryCode("United States")).toBe("US");
    expect(isoCountryCode("UK")).toBe("GB");
    expect(isoCountryCode("Turkey")).toBe("TR");
    expect(isoCountryCode("Türkiye")).toBe("TR");
    expect(isoCountryCode("DR Congo")).toBe("CD");
    expect(isoCountryCode("Ivory Coast")).toBe("CI");
    expect(isoCountryCode("St. Lucia")).toBe("LC");
    expect(isoCountryCode("ke")).toBe("KE");
  });

  it("is null for a blank or unknown name, so the caller keeps its own default", () => {
    expect(isoCountryCode("")).toBeNull();
    expect(isoCountryCode(null)).toBeNull();
    expect(isoCountryCode("Narnia")).toBeNull();
    expect(isoCountryCode("Southeast Asia")).toBeNull();
  });

  // Places with no phone numbers of their own, which the address form's list still offers.
  const NO_PHONE_COUNTRY = [
    "Antarctica",
    "Bouvet Island",
    "French Southern and Antarctic Lands",
    "Heard Island and McDonald Islands",
    "Pitcairn Islands",
    "South Georgia",
    "United States Minor Outlying Islands",
  ];

  it("knows every country the address form offers", () => {
    const phoneCountries = getCountries();
    const unknown = Object.keys(COUNTRY_CONTINENTS).filter(
      (name) => !NO_PHONE_COUNTRY.includes(name) && !phoneCountries.includes(isoCountryCode(name))
    );
    expect(unknown).toEqual([]);
  });
});
