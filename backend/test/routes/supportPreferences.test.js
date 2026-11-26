// Support preferences. Covers the feature gate (404 when it or Care teams is off, data kept),
// who reads and writes a partner's choices (staff; a guest only through a care team seat,
// never through a trip grant alone; a viewer reads only), that the menu is admin-only, how
// each kind of answer is validated and stored in real columns, retiring versus deleting an
// option.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const bcrypt = require("bcryptjs");
const prisma = require("../../src/prismaClient");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

const GROUP = `${FIXTURE_TAG} Support`;

let admin;
let editor;
let viewer;
let originalEnabledFeatures;
let partnerA;
let partnerB;
let member; // guest on partnerA's care team
let tripLeader; // guest with only a trip grant on partnerA
const extraUsers = [];
const optionIds = {};

async function setFeatures(patch) {
  const current = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  const enabledFeatures = { ...(current?.enabledFeatures || {}), ...patch };
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures },
    create: { id: "singleton", enabledFeatures },
  });
}

async function makeGuest(tag) {
  const email = `route-test-supportprefs-${tag}@example.test`;
  const password = "RouteTestSupport123!";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(password, 4), role: "guest", active: true },
    create: {
      email,
      firstName: tag,
      passwordHash: await bcrypt.hash(password, 4),
      role: "guest",
      authProvider: "local",
      active: true,
    },
  });
  extraUsers.push(user.id);
  return { user, login: () => client({ email, password }) };
}

const addOption = (body) => admin("/api/support-preferences/options", { method: "POST", body });
const save = (who, partnerId, preferences) =>
  who(`/api/support-preferences/partner/${partnerId}`, { method: "PUT", body: { preferences } });
const read = (who, partnerId) => who(`/api/support-preferences/partner/${partnerId}`);

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  await removeFixturePartners();
  await prisma.supportOption.deleteMany({ where: { group: { startsWith: FIXTURE_TAG } } });
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ supportPreferences: true, careTeam: true, trips: true });

  partnerA = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} prefsA` },
    })
  ).body;
  partnerB = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} prefsB` },
    })
  ).body;

  member = await makeGuest("member");
  await prisma.careTeamMember.create({ data: { partnerId: partnerA.id, userId: member.user.id } });

  tripLeader = await makeGuest("tripleader");
  const trip = await admin("/api/trips", {
    method: "POST",
    body: { partnerId: partnerA.id, status: "planning" },
  });
  await prisma.tripAccess.create({ data: { userId: tripLeader.user.id, tripId: trip.body.id } });

  // One option of each kind to answer.
  optionIds.offer = (await addOption({ group: GROUP, label: "Airport pick-up", kind: "offer" })).body.id;
  optionIds.single = (
    await addOption({
      group: GROUP,
      label: "How should gifts be sent?",
      kind: "single",
      choices: ["Bank transfer", "A transfer app"],
      allowOther: true,
    })
  ).body.id;
  optionIds.multiple = (
    await addOption({
      group: GROUP,
      label: "Ways to stay in touch",
      kind: "multiple",
      choices: ["Letters", "Video"],
    })
  ).body.id;
  optionIds.text = (await addOption({ group: GROUP, label: "What can be shared?", kind: "text" })).body.id;
});

after(async () => {
  await prisma.supportOption.deleteMany({ where: { group: { startsWith: FIXTURE_TAG } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await removeFixturePartners();
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("support preferences: the feature gate", () => {
  test("404s every route while off, keeps the data, and does not depend on Care teams", async () => {
    const made = await save(admin, partnerA.id, [{ optionId: optionIds.offer, selected: true }]);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    await setFeatures({ supportPreferences: false });
    try {
      assert.equal((await read(admin, partnerA.id)).status, 404);
      assert.equal((await admin("/api/support-preferences/options")).status, 404);
      assert.equal((await save(admin, partnerA.id, [])).status, 404);
    } finally {
      await setFeatures({ supportPreferences: true, careTeam: true });
    }
    // Care teams off makes no difference: Support preferences needs nothing else.
    await setFeatures({ careTeam: false });
    try {
      assert.equal((await read(admin, partnerA.id)).status, 200);
      assert.equal((await admin("/api/support-preferences/options")).status, 200);
    } finally {
      await setFeatures({ supportPreferences: true, careTeam: true });
    }
    const back = await read(admin, partnerA.id);
    assert.ok(
      back.body.preferences.some((p) => p.optionId === optionIds.offer && p.selected),
      "the response survived the flag going off"
    );
  });
});

describe("support preferences: who may read and write", () => {
  test("staff read and write; a viewer reads but cannot write", async () => {
    assert.equal((await read(editor, partnerA.id)).status, 200);
    assert.equal(
      (await save(editor, partnerA.id, [{ optionId: optionIds.offer, selected: true }])).status,
      200
    );
    const asViewer = await read(viewer, partnerA.id);
    assert.equal(asViewer.status, 200);
    assert.equal(asViewer.body.canEdit, false);
    assert.equal(
      (await save(viewer, partnerA.id, [{ optionId: optionIds.offer, selected: false }])).status,
      403
    );
  });

  test("a guest on the partner's care team reads and writes it, and no other partner's", async () => {
    const guest = await member.login();
    const mine = await read(guest, partnerA.id);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.canEdit, true);
    assert.equal(
      (await save(guest, partnerA.id, [{ optionId: optionIds.offer, selected: true }])).status,
      200
    );
    assert.equal((await read(guest, partnerB.id)).status, 403);
    assert.equal(
      (await save(guest, partnerB.id, [{ optionId: optionIds.offer, selected: true }])).status,
      403
    );
  });

  test("a trip leader (a trip grant alone) never reaches it", async () => {
    const guest = await tripLeader.login();
    assert.equal((await read(guest, partnerA.id)).status, 403);
    assert.equal(
      (await save(guest, partnerA.id, [{ optionId: optionIds.offer, selected: true }])).status,
      403
    );
  });

  test("the menu is admin only", async () => {
    assert.equal((await editor("/api/support-preferences/options")).status, 403);
    assert.equal(
      (
        await editor("/api/support-preferences/options", {
          method: "POST",
          body: { group: GROUP, label: "x", kind: "offer" },
        })
      ).status,
      403
    );
    assert.equal((await (await member.login())("/api/support-preferences/options")).status, 403);
  });
});

describe("support preferences: answers are stored in real columns", () => {
  test("each kind round-trips, and an empty response clears it", async () => {
    const res = await save(admin, partnerB.id, [
      { optionId: optionIds.offer, selected: true, note: "Prefers early flights" },
      { optionId: optionIds.single, choice: "Bank transfer" },
      { optionId: optionIds.multiple, choices: ["Letters", "Video", "Letters"] },
      { optionId: optionIds.text, text: "Prayer needs only" },
    ]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.saved, 4);

    const rows = await prisma.partnerSupportPreference.findMany({ where: { partnerId: partnerB.id } });
    const by = (id) => rows.find((r) => r.optionId === id);
    assert.equal(by(optionIds.offer).selected, true);
    assert.equal(by(optionIds.offer).note, "Prefers early flights");
    assert.equal(by(optionIds.single).choice, "Bank transfer");
    assert.equal(by(optionIds.single).selected, true, "a question with an answer counts as chosen");
    assert.deepEqual(by(optionIds.multiple).choices, ["Letters", "Video"], "duplicates collapse");
    assert.equal(by(optionIds.text).text, "Prayer needs only");

    // Sending an empty response for one removes it; the others are left alone.
    const cleared = await save(admin, partnerB.id, [{ optionId: optionIds.text, text: "" }]);
    assert.equal(cleared.body.cleared, 1);
    const left = await prisma.partnerSupportPreference.findMany({ where: { partnerId: partnerB.id } });
    assert.equal(left.length, 3);
  });

  test("rejects an answer that doesn't fit the option", async () => {
    const wrongChoice = await save(admin, partnerB.id, [
      { optionId: optionIds.single, choice: "Cash in an envelope" },
    ]);
    assert.equal(wrongChoice.status, 400);
    const noOther = await save(admin, partnerB.id, [
      { optionId: optionIds.multiple, other: "Smoke signals" },
    ]);
    assert.equal(noOther.status, 400, "this multiple-choice option has no other box");
    const both = await save(admin, partnerB.id, [
      { optionId: optionIds.single, choice: "Bank transfer", other: "Something else" },
    ]);
    assert.equal(both.status, 400);
    const missing = await save(admin, partnerB.id, [{ optionId: "no-such-option", selected: true }]);
    assert.equal(missing.status, 400);
    // An "other" is fine where the option allows one.
    const ok = await save(admin, partnerB.id, [
      { optionId: optionIds.single, other: "Through our mission board" },
    ]);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test("a partner that doesn't exist is a 404", async () => {
    assert.equal((await read(admin, "no-such-partner")).status, 404);
  });
});

describe("support preferences: keeping the menu", () => {
  test("a pick-one or pick-any question needs choices or an other box", async () => {
    const res = await addOption({ group: GROUP, label: "No choices", kind: "single" });
    assert.equal(res.status, 400);
    const withOther = await addOption({
      group: GROUP,
      label: "Other only",
      kind: "single",
      allowOther: true,
    });
    assert.equal(withOther.status, 201);
  });

  test("retiring an option hides it from the menu but keeps the answers; it can't be newly answered", async () => {
    const opt = (await addOption({ group: GROUP, label: "To be retired", kind: "offer" })).body;
    await save(admin, partnerA.id, [{ optionId: opt.id, selected: true }]);
    const retired = await admin(`/api/support-preferences/options/${opt.id}`, {
      method: "PUT",
      body: { active: false },
    });
    assert.equal(retired.status, 200);

    // Partner A still sees it (they answered it); partner B no longer is offered it.
    const a = await read(admin, partnerA.id);
    assert.ok(a.body.options.some((o) => o.id === opt.id && o.active === false));
    const b = await read(admin, partnerB.id);
    assert.ok(!b.body.options.some((o) => o.id === opt.id));
    assert.equal((await save(admin, partnerB.id, [{ optionId: opt.id, selected: true }])).status, 400);
  });

  test("an option's kind can't change once partners have answered it", async () => {
    const res = await admin(`/api/support-preferences/options/${optionIds.offer}`, {
      method: "PUT",
      body: { kind: "text" },
    });
    assert.equal(res.status, 409);
  });

  test("deleting an option takes its answers with it", async () => {
    const opt = (await addOption({ group: GROUP, label: "To be deleted", kind: "offer" })).body;
    await save(admin, partnerA.id, [{ optionId: opt.id, selected: true }]);
    assert.equal(
      (await admin(`/api/support-preferences/options/${opt.id}`, { method: "DELETE" })).status,
      204
    );
    assert.equal(await prisma.partnerSupportPreference.count({ where: { optionId: opt.id } }), 0);
  });

  test("renaming a group renames it on every option in it", async () => {
    const from = `${FIXTURE_TAG} Rename me`;
    await addOption({ group: from, label: "One", kind: "offer" });
    await addOption({ group: from, label: "Two", kind: "offer" });
    const to = `${FIXTURE_TAG} Renamed`;
    const res = await admin("/api/support-preferences/options/rename-group", {
      method: "POST",
      body: { from, to },
    });
    assert.equal(res.body.renamed, 2);
    assert.equal(await prisma.supportOption.count({ where: { group: to } }), 2);
  });

  test("a staff-only option is hidden from a care team guest, who can't answer it either", async () => {
    const secret = (
      await addOption({ group: GROUP, label: "Staff only matter", kind: "text", staffOnly: true })
    ).body;
    assert.equal(secret.staffOnly, true);
    assert.equal(
      (await save(editor, partnerA.id, [{ optionId: secret.id, text: "Private detail" }])).status,
      200
    );

    const asStaff = await read(editor, partnerA.id);
    assert.ok(asStaff.body.options.some((o) => o.id === secret.id));
    assert.equal(asStaff.body.preferences.find((p) => p.optionId === secret.id)?.text, "Private detail");

    const guest = await member.login();
    const asGuest = await read(guest, partnerA.id);
    assert.equal(asGuest.status, 200);
    assert.ok(!asGuest.body.options.some((o) => o.id === secret.id));
    assert.ok(!asGuest.body.preferences.some((p) => p.optionId === secret.id));
    assert.equal((await save(guest, partnerA.id, [{ optionId: secret.id, text: "x" }])).status, 403);
    assert.equal(
      (await prisma.partnerSupportPreference.findFirst({ where: { optionId: secret.id } })).text,
      "Private detail",
      "the guest's attempt changed nothing"
    );

    const open = (
      await admin(`/api/support-preferences/options/${secret.id}`, {
        method: "PUT",
        body: { staffOnly: false },
      })
    ).body;
    assert.equal(open.staffOnly, false);
    assert.ok((await read(guest, partnerA.id)).body.options.some((o) => o.id === secret.id));
  });
});
