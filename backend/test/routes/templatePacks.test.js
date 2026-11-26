// Template packs over the API: admin only, every kind imports additively (nothing a church has is
// removed or duplicated on a second import), each needs its own feature, and what a church has can
// be exported and imported again. Uses packs made of fixture-tagged content so it can clean up.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { FORMAT } = require("../../src/utils/templatePacks");
const { client, stopServer, ensureTestUsers, FIXTURE_TAG } = require("./helpers");

let admin;
let editor;
let originalEnabledFeatures;
let originalWording;

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

const pack = (kind, data, title = `${FIXTURE_TAG} ${kind}`) => ({
  format: FORMAT,
  version: 1,
  kind,
  title,
  description: "test",
  data,
});
const importPack = (who, p) => who("/api/template-packs/import", { method: "POST", body: { pack: p } });

async function cleanup() {
  await prisma.survey.deleteMany({ where: { title: { startsWith: FIXTURE_TAG } } });
  await prisma.supportOption.deleteMany({ where: { group: { startsWith: FIXTURE_TAG } } });
  await prisma.applicationQuestion.deleteMany({ where: { label: { startsWith: FIXTURE_TAG } } });
  await prisma.requirementTemplateItem.deleteMany({ where: { label: { startsWith: FIXTURE_TAG } } });
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  await cleanup();
  const s = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
  originalEnabledFeatures = s?.enabledFeatures ?? {};
  originalWording = {
    emailDispatchSubjectTemplate: s?.emailDispatchSubjectTemplate ?? null,
    emailDispatchSignature: s?.emailDispatchSignature ?? null,
    emailDispatchLayout: s?.emailDispatchLayout ?? null,
  };
  await setFeatures({ surveys: true, careTeam: true, supportPreferences: true, trips: true });
});

after(async () => {
  await cleanup();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures, ...originalWording },
  });
  await stopServer();
});

describe("template packs", () => {
  test("only an admin can preview, import or export", async () => {
    const p = pack("supportMenu", { options: [{ group: `${FIXTURE_TAG} g`, label: "x" }] });
    assert.equal(
      (await editor("/api/template-packs/preview", { method: "POST", body: { pack: p } })).status,
      403
    );
    assert.equal((await importPack(editor, p)).status, 403);
    assert.equal((await editor("/api/template-packs/export/supportMenu")).status, 403);
  });

  test("a bad pack is refused with a reason, and nothing is written", async () => {
    assert.equal((await importPack(admin, { hello: "world" })).status, 400);
    const res = await importPack(
      admin,
      pack("supportMenu", { options: [{ group: `${FIXTURE_TAG} g`, label: "Pick", kind: "single" }] })
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /needs at least one choice/);
    assert.equal(await prisma.supportOption.count({ where: { group: { startsWith: FIXTURE_TAG } } }), 0);
    assert.equal(
      (await admin("/api/template-packs/preview", { method: "POST", body: { pack: "{nope" } })).status,
      400
    );
  });

  test("support menu: previews, imports, and a second import adds nothing", async () => {
    const group = `${FIXTURE_TAG} Housing`;
    const p = pack("supportMenu", {
      options: [
        { group, label: "A place to stay" },
        { group, label: "Gift method", kind: "single", choices: ["Bank", "App"], allowOther: true },
        { group, label: "Secret", kind: "text", staffOnly: true },
      ],
    });
    const preview = await admin("/api/template-packs/preview", { method: "POST", body: { pack: p } });
    assert.equal(preview.status, 200);
    assert.match(preview.body.summary[0], /3 support options/);
    assert.equal(await prisma.supportOption.count({ where: { group } }), 0, "preview writes nothing");

    const first = await importPack(admin, p);
    assert.equal(first.status, 200);
    assert.match(first.body.message, /Added 3/);
    const rows = await prisma.supportOption.findMany({ where: { group }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(
      rows.map((r) => r.sortOrder),
      [1, 2, 3]
    );
    assert.equal(rows[2].staffOnly, true);
    assert.match((await importPack(admin, p)).body.message, /Added 0 .*3 already on your menu/);
    assert.equal(await prisma.supportOption.count({ where: { group } }), 3);

    const exported = await admin("/api/template-packs/export/supportMenu");
    assert.equal(exported.status, 200);
    const out = JSON.parse(exported.text ?? JSON.stringify(exported.body));
    assert.equal(out.kind, "supportMenu");
    assert.ok(out.data.options.some((o) => o.label === "Gift method" && o.allowOther === true));
  });

  test("trip application questions and requirements append, never duplicate, and keep what exists", async () => {
    const q = pack("applicationQuestions", {
      tripApplicationTemplate: [{ label: `${FIXTURE_TAG} Why do you want to go?`, type: "textarea" }],
      tripQuestionLibrary: [
        { label: `${FIXTURE_TAG} Passport?`, type: "select", options: ["Yes", "No"], required: true },
      ],
    });
    const before = await prisma.applicationQuestion.count();
    assert.match(
      (await importPack(admin, q)).body.message,
      /Added 1 application question and 1 to the library/
    );
    assert.equal(await prisma.applicationQuestion.count(), before + 2);
    assert.match((await importPack(admin, q)).body.message, /Added 0 application questions and 0/);
    assert.equal(await prisma.applicationQuestion.count(), before + 2);

    const r = pack("tripRequirements", {
      tripRequirementTemplate: [
        { label: `${FIXTURE_TAG} Waiver`, kind: "esignature", bodyText: "I agree", minorsOnly: false },
      ],
    });
    const rb = await prisma.requirementTemplateItem.count();
    assert.equal((await importPack(admin, r)).status, 200);
    assert.equal(await prisma.requirementTemplateItem.count(), rb + 1);
    assert.equal((await importPack(admin, r)).status, 200);
    assert.equal(await prisma.requirementTemplateItem.count(), rb + 1);
  });

  test("email update wording replaces only the fields in the pack", async () => {
    await prisma.churchSettings.update({
      where: { id: "singleton" },
      data: { emailDispatchSignature: "Keep me" },
    });
    const res = await importPack(
      admin,
      pack("dispatchWording", { emailDispatchSubjectTemplate: `${FIXTURE_TAG} {church}` })
    );
    assert.equal(res.status, 200);
    const s = await prisma.churchSettings.findUnique({ where: { id: "singleton" } });
    assert.equal(s.emailDispatchSubjectTemplate, `${FIXTURE_TAG} {church}`);
    assert.equal(s.emailDispatchSignature, "Keep me");
  });

  test("a survey pack becomes a draft, and exporting it gives back an equivalent pack", async () => {
    const p = pack("survey", {
      survey: {
        title: `${FIXTURE_TAG} Check-in`,
        intro: "Hello",
        questions: [
          { kind: "text", label: "Phone?", field: "primaryPhone", required: true },
          { kind: "single", label: "Best day", choices: ["Mon", "Tue"], allowOther: true },
        ],
      },
    });
    const made = await importPack(admin, p);
    assert.equal(made.status, 200);
    const exported = await admin(`/api/template-packs/export/survey?surveyId=${made.body.surveyId}`);
    assert.equal(exported.status, 200);
    const out = JSON.parse(exported.text ?? JSON.stringify(exported.body));
    assert.equal(out.format, FORMAT);
    assert.deepEqual(out.data.survey.questions, [
      { kind: "text", label: "Phone?", required: true, field: "primaryPhone" },
      { kind: "single", label: "Best day", choices: ["Mon", "Tue"], allowOther: true },
    ]);
    const bad = pack("survey", {
      survey: {
        title: `${FIXTURE_TAG} Bad`,
        questions: [{ kind: "multiple", label: "x", choices: ["a"], field: "primaryPhone" }],
      },
    });
    assert.equal((await importPack(admin, bad)).status, 400);
  });

  test("each kind needs its feature", async () => {
    await setFeatures({ supportPreferences: false });
    assert.equal(
      (await importPack(admin, pack("supportMenu", { options: [{ group: `${FIXTURE_TAG} g`, label: "x" }] })))
        .status,
      400
    );
    assert.equal((await admin("/api/template-packs/export/supportMenu")).status, 404);
    await setFeatures({ supportPreferences: true });
    await setFeatures({ surveys: false });
    assert.equal((await admin("/api/template-packs/export/survey?surveyId=x")).status, 404);
    await setFeatures({ surveys: true });
  });
});
