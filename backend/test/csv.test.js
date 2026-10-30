const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { toCsv, csvFilename, escapeField } = require("../src/utils/csv");

const columns = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount ($)" },
];

describe("escapeField", () => {
  test("leaves ordinary values alone", () => {
    assert.equal(escapeField("Grace Tillman"), "Grace Tillman");
    assert.equal(escapeField(1000), "1000");
  });

  test("quotes a value containing a comma", () => {
    // The whole reason this module exists. An unquoted comma silently
    // becomes a column break and every field after it shifts.
    assert.equal(escapeField("Wexford, Frank"), '"Wexford, Frank"');
  });

  test("doubles embedded quotes", () => {
    assert.equal(escapeField('He said "yes"'), '"He said ""yes"""');
  });

  test("quotes newlines, including a bare carriage return", () => {
    assert.equal(escapeField("line one\nline two"), '"line one\nline two"');
    // Excel treats a bare CR inside an unquoted field as a row break, so
    // this needs quoting even though it isn't a \n.
    assert.equal(escapeField("line one\rline two"), '"line one\rline two"');
  });

  test("renders null and undefined as empty, not as the word", () => {
    assert.equal(escapeField(null), "");
    assert.equal(escapeField(undefined), "");
  });

  test("renders a date-only value as the calendar date stored", () => {
    // Prisma returns @db.Date as UTC midnight. Formatting it through the
    // local calendar would shift it a day west of UTC -- the same trap as
    // toMonthDay and toDateInputValue.
    assert.equal(escapeField(new Date("1979-05-04T00:00:00.000Z")), "1979-05-04");
  });
});

describe("toCsv", () => {
  test("header comes from the column labels, in column order", () => {
    const csv = toCsv([], columns, { bom: false });
    assert.equal(csv.split("\r\n")[0], "Name,Amount ($)");
  });

  test("body follows the same column order, not the object's key order", () => {
    // Guards against a row built in a different order than `columns`
    // silently producing shifted output.
    const csv = toCsv([{ amount: 500, name: "Grace Tillman" }], columns, { bom: false });
    assert.equal(csv.split("\r\n")[1], "Grace Tillman,500");
  });

  test("a key missing from a row becomes an empty field, not a gap", () => {
    const csv = toCsv([{ name: "Grace Tillman" }], columns, { bom: false });
    assert.equal(csv.split("\r\n")[1], "Grace Tillman,");
  });

  test("uses CRLF line endings and ends with one", () => {
    const csv = toCsv([{ name: "A", amount: 1 }], columns, { bom: false });
    assert.equal(csv, "Name,Amount ($)\r\nA,1\r\n");
  });

  test("starts with a UTF-8 BOM by default", () => {
    // Without it, Excel on Windows reads UTF-8 as the system code page and
    // mangles any accented partner or field name.
    const csv = toCsv([], columns);
    assert.equal(csv.charCodeAt(0), 0xfeff);
  });

  test("survives a round trip through a naive splitter for simple rows", () => {
    const rows = [{ name: "Muñoz", amount: 25 }];
    const csv = toCsv(rows, columns, { bom: false });
    const [, line] = csv.trim().split("\r\n");
    assert.deepEqual(line.split(","), ["Muñoz", "25"]);
  });
});

describe("csvFilename", () => {
  test("slugs the label and stamps the local date", () => {
    const name = csvFilename("Upcoming Birthdays", { now: new Date(2026, 9, 28) });
    assert.equal(name, "upcoming-birthdays-2026-10-28.csv");
  });

  test("strips characters that have no business in a filename", () => {
    const name = csvFilename("One-Time Needs ($)", { now: new Date(2026, 0, 5) });
    assert.equal(name, "one-time-needs-2026-01-05.csv");
  });

  test("falls back rather than producing a bare extension", () => {
    const name = csvFilename("!!!", { now: new Date(2026, 0, 5) });
    assert.equal(name, "report-2026-01-05.csv");
  });
});
