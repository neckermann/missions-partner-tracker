// The country a phone number typed without a "+" is read in (ChurchSettings.defaultPhoneCountry, an
// ISO 3166-1 code such as "US" or "GB"). The zod checks that read it are synchronous, so the value is
// kept here: loaded once at start-up and refreshed whenever the setting is saved. One process serves
// the app (there is no separate worker), so a plain module variable is enough.
const { getCountries } = require("libphonenumber-js/min");

const DEFAULT_PHONE_COUNTRY = "US";
const KNOWN = new Set(getCountries());

const isValidPhoneCountry = (code) => typeof code === "string" && KNOWN.has(code);

let current = DEFAULT_PHONE_COUNTRY;

const getPhoneCountry = () => current;

// Sets the country, ignoring anything that isn't a known code (a bad value must never break saving).
function setPhoneCountry(code) {
  current = isValidPhoneCountry(code) ? code : DEFAULT_PHONE_COUNTRY;
  return current;
}

async function loadPhoneCountry(prisma) {
  const row = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { defaultPhoneCountry: true },
  });
  return setPhoneCountry(row?.defaultPhoneCountry);
}

module.exports = {
  DEFAULT_PHONE_COUNTRY,
  isValidPhoneCountry,
  getPhoneCountry,
  setPhoneCountry,
  loadPhoneCountry,
};
