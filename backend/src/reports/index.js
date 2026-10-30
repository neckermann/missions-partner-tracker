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
const prayerRequests = require("./prayerRequests");
const tripHistory = require("./tripHistory");
const monthlySupport = require("./monthlySupport");

const REPORTS = [upcomingBirthdays, oneTimeNeeds, prayerRequests, tripHistory, monthlySupport];

const byId = new Map(REPORTS.map((r) => [r.id, r]));

function getReport(id) {
  return byId.get(String(id)) || null;
}

// What the picker needs: enough to render the list and build a filter form,
// without shipping the queries themselves. `requiresFeature` travels too --
// the route uses it to drop a report whose underlying feature is off; it's
// an internal gating detail, not form metadata, but it's cheap to include
// and the alternative is a second lookup back into REPORTS.
//
// `params` is described by hand rather than reflected out of the Zod schema.
// Zod's internals are not a stable public shape to walk, and a form needs
// things a validator doesn't carry anyway -- a label, a control type, an
// order. Two small lists beat one clever introspection that breaks on a Zod
// upgrade.
//
// `prisma` is a parameter here, not a require at the top of this file, on
// purpose: this module stays DB-agnostic (it's a registry, not a query
// runner), and the one thing that needs live data -- a report whose filter
// options come from what's actually on file, like Trip History's trip
// types and years -- gets it handed in by the route instead. A report
// module opts into that by exporting `resolveFields(prisma)`, which returns
// its `fields` with the dynamic ones filled in; a report with no such
// method just uses its static `fields` unchanged, same as before.
async function listReports(prisma) {
  return Promise.all(
    REPORTS.map(async (r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      columns: r.columns,
      fields: r.resolveFields ? await r.resolveFields(prisma) : r.fields,
      requiresFeature: r.requiresFeature || null,
    }))
  );
}

module.exports = { REPORTS, getReport, listReports };
