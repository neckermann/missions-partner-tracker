// B7: a time zone change saved in Settings takes effect at once. It used to apply only at start-up, so the
// scheduled jobs kept the old zone until both services were restarted.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { client, stopServer, ensureTestUsers, removeTestUsers } = require("./helpers");
const { churchToday } = require("../../src/utils/today");

let admin;
let originalTimezone;
const originalTz = process.env.TZ;

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  originalTimezone =
    (await prisma.churchSettings.findUnique({ where: { id: "singleton" } }))?.timezone ?? null;
});

after(async () => {
  await prisma.churchSettings.updateMany({
    where: { id: "singleton" },
    data: { timezone: originalTimezone },
  });
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  await removeTestUsers();
  await stopServer();
});

describe("saving the time zone", () => {
  test("applies to this process straight away, with no restart", async () => {
    const at = new Date("2026-11-26T20:00:00Z");

    const east = await admin("/api/settings", { method: "PUT", body: { timezone: "Pacific/Auckland" } });
    assert.equal(east.status, 200, JSON.stringify(east.body));
    assert.equal(process.env.TZ, "Pacific/Auckland");
    assert.equal(churchToday(at).toISOString().slice(0, 10), "2026-11-27");

    const west = await admin("/api/settings", { method: "PUT", body: { timezone: "America/Los_Angeles" } });
    assert.equal(west.status, 200);
    assert.equal(process.env.TZ, "America/Los_Angeles");
    assert.equal(churchToday(at).toISOString().slice(0, 10), "2026-11-26");
  });

  test("a save that does not touch the time zone leaves it alone", async () => {
    await admin("/api/settings", { method: "PUT", body: { timezone: "Asia/Tokyo" } });
    assert.equal(process.env.TZ, "Asia/Tokyo");
    const other = await admin("/api/settings", { method: "PUT", body: { churchName: "Zone Test Church" } });
    assert.equal(other.status, 200);
    assert.equal(process.env.TZ, "Asia/Tokyo");
    await prisma.churchSettings.updateMany({ where: { id: "singleton" }, data: { churchName: null } });
  });
});
