// The church-wide currency: how an amount is written, and what a bad code does.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { isValidCurrency, currencyOrDefault, formatMoney, currencySymbol } = require("../src/utils/money");

describe("currency codes", () => {
  test("accepts real codes and nothing else", () => {
    for (const ok of ["USD", "EUR", "CAD", "GBP", "MXN", "PHP"]) assert.equal(isValidCurrency(ok), true, ok);
    for (const bad of ["usd", "US", "USDX", "", null, undefined, "ZZZ", 5, "$"]) {
      assert.equal(isValidCurrency(bad), false, String(bad));
    }
  });

  test("a bad or missing code falls back to USD instead of breaking a message", () => {
    assert.equal(currencyOrDefault("EUR"), "EUR");
    assert.equal(currencyOrDefault("nonsense"), "USD");
    assert.equal(currencyOrDefault(undefined), "USD");
  });
});

describe("formatMoney", () => {
  test("USD reads exactly as it always has: whole dollars, thousands separated", () => {
    assert.equal(formatMoney(1000, "USD"), "$1,000");
    assert.equal(formatMoney(25, undefined), "$25");
    assert.equal(formatMoney("1500", "USD"), "$1,500");
  });

  test("other currencies use their own symbol and still show no cents", () => {
    assert.equal(formatMoney(1000, "EUR"), "€1,000");
    assert.equal(formatMoney(1000, "GBP"), "£1,000");
    assert.equal(formatMoney(1000, "CAD"), "CA$1,000");
  });

  test("a currency with no minor unit is not given one", () => {
    assert.equal(formatMoney(1000, "JPY"), "¥1,000");
  });
});

describe("currencySymbol", () => {
  test("gives the symbol for a column heading", () => {
    assert.equal(currencySymbol("USD"), "$");
    assert.equal(currencySymbol("EUR"), "€");
    assert.equal(currencySymbol("CAD"), "CA$");
    assert.equal(currencySymbol(undefined), "$");
  });
});
