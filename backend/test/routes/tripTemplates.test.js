// The application questions (a trip's own, the church-wide ones and their library), the
// requirement checklist and its library, and the answers on an application are real rows.
// Covers that each list saves whole and in order, that a question's id stays put across saves,
// that a copy never shares an id, that an answer keeps the question's wording when the
// question is changed or deleted, and that a clone copies a trip's questions.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const {
  loadQuestions,
  replaceQuestions,
  loadRequirementItems,
  replaceRequirementItems,
} = require("../../src/utils/tripTemplates");
const {
  client,
  stopServer,
  ensureTestUsers,
  removeTestUsers,
  removeFixturePartners,
  FIXTURE_TAG,
} = require("./helpers");

let admin;
let anon;
let originalFeatures;
let saved; // the church-wide lists as they were

before(async () => {
  await ensureTestUsers();
  [admin, anon] = await Promise.all([client("admin"), client(null)]);
  await removeFixturePartners();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalFeatures = settings?.enabledFeatures ?? {};
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    update: { enabledFeatures: { ...originalFeatures, trips: true, publicTripDiscovery: true } },
    create: { id: "singleton", enabledFeatures: { trips: true, publicTripDiscovery: true } },
  });
  saved = {
    template: await loadQuestions("template"),
    library: await loadQuestions("library"),
    reqTemplate: await loadRequirementItems("template"),
    reqLibrary: await loadRequirementItems("library"),
  };
  await replaceQuestions(prisma, "template", null, []);
  await replaceQuestions(prisma, "library", null, []);
  await replaceRequirementItems(prisma, "template", []);
  await replaceRequirementItems(prisma, "library", []);
});

after(async () => {
  await removeFixturePartners();
  await replaceQuestions(prisma, "template", null, saved.template);
  await replaceQuestions(prisma, "library", null, saved.library);
  await replaceRequirementItems(prisma, "template", saved.reqTemplate);
  await replaceRequirementItems(prisma, "library", saved.reqLibrary);
  await removeTestUsers();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalFeatures },
  });
  await stopServer();
});

const newTrip = async (extra = {}) => {
  const partner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} templates ${Math.random()}` },
    })
  ).body;
  return (
    await admin("/api/trips", {
      method: "POST",
      body: {
        partnerId: partner.id,
        name: `${FIXTURE_TAG} trip`,
        status: "accepting_applications",
        isPublic: true,
        ...extra,
      },
    })
  ).body;
};
const putSettings = (body) => admin("/api/settings/trips", { method: "PUT", body });
const apply = (tripId, responses) =>
  anon(`/api/public/trips/${tripId}/apply`, {
    method: "POST",
    body: {
      firstName: "Pat",
      lastName: "Applicant",
      email: "pat@example.test",
      dateOfBirth: "1990-01-01",
      responses,
    },
  });

describe("the church-wide lists", () => {
  test("save whole and in order, and come back with stable ids", async () => {
    const res = await putSettings({
      tripApplicationTemplate: [
        { id: "x1", label: "First", required: true },
        { id: "x2", label: "Pick one", type: "select", options: ["A", "B"] },
      ],
      tripQuestionLibrary: [{ id: "l1", label: "Passport?", type: "text" }],
      tripRequirementTemplate: [{ id: "r1", label: "Waiver", kind: "esignature", bodyText: "I agree" }],
      tripRequirementLibrary: [{ id: "r2", label: "Minor release", kind: "task", minorsOnly: true }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.tripApplicationTemplate.map((q) => [q.label, q.type, q.required, q.options]),
      [
        ["First", "text", true, undefined],
        ["Pick one", "select", false, ["A", "B"]],
      ]
    );
    assert.equal(res.body.tripRequirementTemplate[0].bodyText, "I agree");
    assert.equal(res.body.tripRequirementLibrary[0].minorsOnly, true);

    // Reordering and editing one keeps its id; dropping one deletes it.
    const [first, second] = res.body.tripApplicationTemplate;
    const again = await putSettings({
      tripApplicationTemplate: [{ ...second, label: "Pick one (edited)" }],
    });
    assert.equal(again.body.tripApplicationTemplate.length, 1);
    assert.equal(again.body.tripApplicationTemplate[0].id, second.id);
    assert.equal(await prisma.applicationQuestion.count({ where: { id: first.id } }), 0);
    // A list not sent is left alone.
    assert.equal(again.body.tripQuestionLibrary.length, 1);

    const read = await admin("/api/settings/trips");
    assert.equal(read.body.tripApplicationTemplate[0].label, "Pick one (edited)");
    const general = await admin("/api/settings");
    assert.equal(general.body.tripApplicationTemplate[0].label, "Pick one (edited)");
  });

  test("a copy with the same id is a separate row, not a collision", async () => {
    const res = await putSettings({
      tripQuestionLibrary: [{ id: "dup", label: "Shared id" }],
      tripApplicationTemplate: [{ id: "dup", label: "Shared id" }],
    });
    assert.equal(res.status, 200);
    const ids = [...res.body.tripQuestionLibrary, ...res.body.tripApplicationTemplate].map((q) => q.id);
    assert.equal(new Set(ids).size, 2);
  });
});

describe("a trip's own questions", () => {
  test("save with the trip, read back in order, and are copied (with new ids) by a clone", async () => {
    const trip = await newTrip({
      applicationQuestions: [
        { id: "a", label: "Diet?" },
        { id: "b", label: "Skills", type: "checkboxes", options: ["Cook", "Build"] },
      ],
    });
    assert.deepEqual(
      trip.applicationQuestions.map((q) => q.label),
      ["Diet?", "Skills"]
    );
    const fetched = await admin(`/api/trips/${trip.id}`);
    assert.deepEqual(fetched.body.applicationQuestions[1].options, ["Cook", "Build"]);

    const edited = await admin(`/api/trips/${trip.id}`, {
      method: "PUT",
      body: { applicationQuestions: [fetched.body.applicationQuestions[1]] },
    });
    assert.equal(edited.body.applicationQuestions.length, 1);
    assert.equal(edited.body.applicationQuestions[0].id, fetched.body.applicationQuestions[1].id);

    const clone = await admin(`/api/trips/${trip.id}/clone`, { method: "POST" });
    assert.equal(clone.status, 201);
    assert.equal(clone.body.applicationQuestions.length, 1);
    assert.notEqual(clone.body.applicationQuestions[0].id, edited.body.applicationQuestions[0].id);

    // Deleting the trip takes its questions with it.
    await admin(`/api/trips/${clone.body.id}`, { method: "DELETE" });
    assert.equal(await prisma.applicationQuestion.count({ where: { tripId: clone.body.id } }), 0);
  });
});

describe("answers on an application", () => {
  test("are stored per question with its wording, shown to staff, and survive the question changing or going", async () => {
    await putSettings({ tripApplicationTemplate: [{ id: "t", label: "Church-wide question" }] });
    const trip = await newTrip({
      applicationQuestions: [
        { id: "p", label: "Passport?", type: "select", options: ["Yes", "No"] },
        { id: "s", label: "Skills", type: "checkboxes", options: ["Cook", "Build"] },
      ],
    });
    const form = await anon(`/api/public/trips/${trip.id}`);
    assert.equal(form.status, 200);
    const [tmpl, passport, skills] = form.body.applicationQuestions;
    assert.equal(tmpl.label, "Church-wide question", "the church-wide question comes first");

    const res = await apply(trip.id, {
      [tmpl.id]: "Because",
      [passport.id]: "Yes",
      [skills.id]: ["Cook", "Build"],
      "not-a-question": "ignored",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const rows = await prisma.tripApplicationAnswer.findMany({
      orderBy: { position: "asc" },
      where: { application: { tripId: trip.id } },
    });
    assert.deepEqual(
      rows.map((r) => [r.label, r.value, r.values]),
      [
        ["Church-wide question", "Because", []],
        ["Passport?", "Yes", []],
        ["Skills", null, ["Cook", "Build"]],
      ]
    );

    const list = await admin(`/api/trips/${trip.id}/applications`);
    assert.equal(list.body[0].answers.length, 3);

    // The question is reworded, then removed: the answer keeps what was asked.
    await admin(`/api/trips/${trip.id}`, {
      method: "PUT",
      body: { applicationQuestions: [{ ...passport, label: "Valid passport?" }] },
    });
    const after = await admin(`/api/trips/${trip.id}/applications`);
    const byLabel = Object.fromEntries(after.body[0].answers.map((a) => [a.label, a]));
    assert.ok(byLabel["Passport?"], "still labelled as it was asked");
    assert.equal(byLabel["Passport?"].questionId, passport.id, "still linked while the question exists");
    assert.equal(byLabel["Skills"].questionId, null, "its question was removed");
    assert.deepEqual(byLabel["Skills"].values, ["Cook", "Build"]);
  });
});

describe("the requirement checklist", () => {
  test("is copied onto a new active trip as real requirements, and not onto a backfilled one", async () => {
    await putSettings({
      tripRequirementTemplate: [
        { id: "q", label: "Passport copy", kind: "document" },
        { id: "w", label: "Waiver", kind: "esignature", bodyText: "Sign here", reminderLeadDays: 7 },
      ],
    });
    const active = await newTrip();
    assert.deepEqual(active.requirements.map((r) => [r.label, r.kind, r.reminderLeadDays]).sort(), [
      ["Passport copy", "document", null],
      ["Waiver", "esignature", 7],
    ]);
    const past = await newTrip({ status: "completed" });
    assert.equal(past.requirements.length, 0);
  });
});
