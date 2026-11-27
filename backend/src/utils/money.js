// One church-wide currency (ChurchSettings.currency, an ISO 4217 code). Amounts are stored as whole numbers with
// no currency of their own, so this only decides how they are written; it never converts.
const DEFAULT_CURRENCY = "USD";

function isValidCurrency(code) {
  return (
    typeof code === "string" && /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf("currency").includes(code)
  );
}

// The code to use: the church's if it is valid, otherwise USD (a bad or missing value never breaks a message).
function currencyOrDefault(code) {
  return isValidCurrency(code) ? code : DEFAULT_CURRENCY;
}

// "$1,000" / "€1,000" / "CA$1,000": whole amounts, no cents, in the same en-US form the app has always used.
function formatMoney(amount, code) {
  return Number(amount).toLocaleString("en-US", {
    style: "currency",
    currency: currencyOrDefault(code),
    maximumFractionDigits: 0,
  });
}

// Just the symbol ("$", "€", "CA$"), for a column heading.
function currencySymbol(code) {
  const part = new Intl.NumberFormat("en-US", { style: "currency", currency: currencyOrDefault(code) })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part ? part.value : currencyOrDefault(code);
}

module.exports = { DEFAULT_CURRENCY, isValidCurrency, currencyOrDefault, formatMoney, currencySymbol };
