// The report registry.
//
// Adding a report is adding a module here -- a Zod param schema, a column
// list, and a plain Prisma query it writes itself. There is deliberately no
// generic query builder: the shared machinery is the shell (the page, the
// filter form, the table, the CSV serializer, the print styles), and the
// queries stay dumb. That boundary is what keeps this from turning into the
// configurable-everything abstraction the v2.0.2 review warned off, and it
// means a badly written report breaks one report.
//
// Reports are read-only. Editing still happens on the resource pages --
// you answer a prayer request on /admin/prayer-requests and export one from
// here. Same data, different job.

const upcomingBirthdays = require("./upcomingBirthdays");
const oneTimeNeeds = require("./oneTimeNeeds");

const REPORTS = [upcomingBirthdays, oneTimeNeeds];

const byId = new Map(REPORTS.map((r) => [r.id, r]));

function getReport(id) {
  return byId.get(String(id)) || null;
}

// What the picker needs: enough to render the list and build a filter form,
// without shipping the queries themselves.
//
// `params` is described by hand rather than reflected out of the Zod schema.
// Zod's internals are not a stable public shape to walk, and a form needs
// things a validator doesn't carry anyway -- a label, a control type, an
// order. Two small lists beat one clever introspection that breaks on a Zod
// upgrade.
function listReports() {
  return REPORTS.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    columns: r.columns,
    fields: r.fields,
  }));
}

module.exports = { REPORTS, getReport, listReports };
