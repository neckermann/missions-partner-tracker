// Survey templates and the approve-and-update flow (#419): a survey built from a template, answers
// that differ from the record becoming proposed changes (never edits), a person approving
// (optionally editing), rejecting or finding it already decided, and a partner's photo waiting for
// approval before it reaches the record.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { newInviteToken } = require("../../src/utils/surveys");
const { client, stopServer, ensureTestUsers, removeFixturePartners, FIXTURE_TAG } = require("./helpers");

let admin;
let editor;
let viewer;
let anon;
let partner;
let survey;
let questions;
let originalEnabledFeatures;

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

const cleanup = async () => {
  await prisma.survey.deleteMany({ where: { title: { startsWith: FIXTURE_TAG } } });
  await removeFixturePartners();
};

const answerFor = (label, body) => ({ questionId: questions.find((q) => q.label === label).id, ...body });
const pending = async () =>
  (await editor("/api/survey-updates")).body.updates.filter((u) => u.partnerId === partner.id);

// A 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

before(async () => {
  await ensureTestUsers();
  [admin, editor, viewer, anon] = await Promise.all([
    client("admin"),
    client("editor"),
    client("viewer"),
    client(null),
  ]);
  await cleanup();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ surveys: true, careTeam: true });
  partner = (
    await admin("/api/partners", {
      method: "POST",
      body: {
        kind: "missionary",
        displayName: `${FIXTURE_TAG} updP`,
        adults: [
          {
            firstName: "Pat",
            lastName: "Doe",
            phone1: "(111) 111-1111",
            email: "old@example.test",
            isPrimaryContact: true,
          },
        ],
      },
    })
  ).body;
});

after(async () => {
  await cleanup();
  await prisma.churchSettings.update({
    where: { id: "singleton" },
    data: { enabledFeatures: originalEnabledFeatures },
  });
  await stopServer();
});

describe("survey templates and updates", () => {
  test("templates are listed and make an ordinary editable survey", async () => {
    const list = await editor("/api/surveys/templates");
    assert.equal(list.status, 200);
    assert.ok(list.body.templates.some((t) => t.id === "annual-update"));
    assert.equal((await viewer("/api/surveys/templates")).status, 403);
    assert.equal(
      (await editor("/api/surveys/from-template", { method: "POST", body: { templateId: "nope" } })).status,
      404
    );

    const made = await editor("/api/surveys/from-template", {
      method: "POST",
      body: { templateId: "annual-update", title: `${FIXTURE_TAG} Annual` },
    });
    assert.equal(made.status, 201);
    survey = made.body;
    const full = (await editor(`/api/surveys/${survey.id}`)).body;
    questions = full.questions;
    assert.equal(full.status, "draft");
    assert.ok(questions.some((q) => q.field === "primaryPhone"));
    assert.ok(questions.some((q) => q.kind === "photo" && q.field === "photo"));
    const fields = (await editor("/api/surveys/fields")).body.fields.map((f) => f.key);
    assert.ok(fields.includes("primaryEmail"));
  });

  test("a question can only link a field that fits it", async () => {
    const bad = await editor(`/api/surveys/${survey.id}/questions`, {
      method: "PUT",
      body: { questions: [{ kind: "multiple", label: "x", choices: ["a"], field: "primaryPhone" }] },
    });
    assert.equal(bad.status, 400);
    // restore the template's questions (ids kept so nothing is lost)
    const ok = await editor(`/api/surveys/${survey.id}/questions`, {
      method: "PUT",
      body: {
        questions: questions.map((q) => ({
          id: q.id,
          kind: q.kind,
          label: q.label,
          choices: q.choices,
          allowOther: q.allowOther,
          required: q.required,
          field: q.field,
        })),
      },
    });
    assert.equal(ok.status, 200);
    assert.equal(
      (await editor(`/api/surveys/${survey.id}`, { method: "PUT", body: { status: "open" } })).status,
      200
    );
  });

  test("answers that differ become proposals and change nothing; matching answers propose nothing", async () => {
    const path = `/api/surveys/${survey.id}/partner/${partner.id}`;
    const res = await editor(path, {
      method: "PUT",
      body: {
        submit: true,
        answers: [
          answerFor("Best phone number to reach you", { value: "(337) 555-0100" }),
          answerFor("Best email address to reach you", { value: "OLD@example.test" }),
          answerFor("Emergency contact: name", { value: "Sam Doe" }),
          answerFor("How do you prefer to be contacted?", { value: "text" }),
        ],
      },
    });
    assert.equal(res.status, 200);
    const list = await pending();
    assert.deepEqual(list.map((u) => u.field).sort(), [
      "contactMethod",
      "emergencyContactName",
      "primaryPhone",
    ]);
    const phone = list.find((u) => u.field === "primaryPhone");
    assert.equal(phone.currentValue, "(111) 111-1111");
    const adult = await prisma.adult.findFirst({ where: { partnerId: partner.id } });
    assert.equal(adult.phone1, "(111) 111-1111", "nothing is applied until someone approves");

    assert.equal((await viewer("/api/survey-updates")).status, 403);
    assert.equal((await anon("/api/survey-updates")).status, 401);
  });

  test("approve applies it; edit-then-approve applies the edited value; a bad value is refused", async () => {
    const list = await pending();
    const phone = list.find((u) => u.field === "primaryPhone");
    const approved = await editor(`/api/survey-updates/${phone.id}/approve`, { method: "POST", body: {} });
    assert.equal(approved.status, 200);
    const adult = await prisma.adult.findFirst({ where: { partnerId: partner.id } });
    assert.equal(adult.phone1, "(337) 555-0100");
    assert.ok(adult.lastEditedByName, "credited to the approver");
    assert.equal(
      (await editor(`/api/survey-updates/${phone.id}/approve`, { method: "POST", body: {} })).status,
      409
    );

    const method = list.find((u) => u.field === "contactMethod");
    const badEdit = await editor(`/api/survey-updates/${method.id}/approve`, {
      method: "POST",
      body: { value: "smoke signal" },
    });
    assert.equal(badEdit.status, 400);
    const good = await editor(`/api/survey-updates/${method.id}/approve`, {
      method: "POST",
      body: { value: "whatsapp" },
    });
    assert.equal(good.status, 200);
    assert.equal(
      (await prisma.adult.findFirst({ where: { partnerId: partner.id } })).contactMethod,
      "whatsapp"
    );

    const name = list.find((u) => u.field === "emergencyContactName");
    assert.equal((await editor(`/api/survey-updates/${name.id}/reject`, { method: "POST" })).status, 200);
    assert.equal((await prisma.partner.findUnique({ where: { id: partner.id } })).emergencyContactName, null);

    const decided = await editor("/api/survey-updates?status=decided");
    const mine = decided.body.updates.filter((u) => u.partnerId === partner.id);
    assert.deepEqual(mine.map((u) => u.status).sort(), ["approved", "approved", "rejected"]);
    assert.equal((await pending()).length, 0);
  });

  test("a decided answer isn't proposed again when the same response is submitted again", async () => {
    const path = `/api/surveys/${survey.id}/partner/${partner.id}`;
    await editor(path, {
      method: "PUT",
      body: { submit: true, answers: [answerFor("Emergency contact: name", { value: "Sam Doe" })] },
    });
    assert.equal((await pending()).length, 0, "the same rejected value stays rejected");
    await editor(path, {
      method: "PUT",
      body: { submit: true, answers: [answerFor("Emergency contact: name", { value: "Samantha Doe" })] },
    });
    assert.deepEqual(
      (await pending()).map((u) => u.proposedValue),
      ["Samantha Doe"]
    );
    await editor(path, {
      method: "PUT",
      body: { submit: true, answers: [answerFor("Emergency contact: name", { value: "Sam D." })] },
    });
    assert.deepEqual(
      (await pending()).map((u) => u.proposedValue),
      ["Sam D."],
      "a changed answer replaces the pending one"
    );
    await editor(`/api/survey-updates/${(await pending())[0].id}/reject`, { method: "POST" });
  });

  test("a photo from the link waits for approval; bad uploads are refused; approving adds a Photo", async () => {
    const photoQ = questions.find((q) => q.kind === "photo");
    const { token, tokenHash, expiresAt } = newInviteToken();
    await prisma.surveyInvite.create({
      data: { surveyId: survey.id, partnerId: partner.id, tokenHash, expiresAt, sentAt: new Date() },
    });
    const url = `/api/public/survey-uploads/${token}/${photoQ.id}`;
    const send = (contentType, buf) =>
      anon(url, { method: "POST", body: { contentType, data: buf.toString("base64") } });

    assert.equal((await send("text/html", Buffer.from("<script>"))).status, 400);
    assert.equal(
      (await send("image/png", Buffer.from("not really a png"))).status,
      400,
      "signature must match"
    );
    assert.equal(
      (
        await anon(`/api/public/survey-uploads/${"z".repeat(43)}/${photoQ.id}`, {
          method: "POST",
          body: { contentType: "image/png", data: "AA" },
        })
      ).status,
      404
    );
    const textQ = questions.find((q) => q.kind === "text");
    assert.equal(
      (
        await anon(`/api/public/survey-uploads/${token}/${textQ.id}`, {
          method: "POST",
          body: { contentType: "image/png", data: PNG.toString("base64") },
        })
      ).status,
      400
    );

    assert.equal((await send("image/png", PNG)).status, 200);
    const page = await anon(`/api/public/surveys/${token}`);
    assert.deepEqual(page.body.photos, [photoQ.id]);
    const submit = await anon(`/api/public/surveys/${token}/submit`, {
      method: "POST",
      body: { answers: [] },
    });
    assert.equal(submit.status, 200);

    const before = await prisma.photo.count({ where: { partnerId: partner.id } });
    const proposal = (await pending()).find((u) => u.field === "photo");
    assert.ok(proposal?.photoUploadId);
    const raw = await editor(`/api/survey-updates/photo/${proposal.photoUploadId}`);
    assert.equal(raw.status, 200);
    assert.equal((await viewer(`/api/survey-updates/photo/${proposal.photoUploadId}`)).status, 403);
    assert.equal(
      await prisma.photo.count({ where: { partnerId: partner.id } }),
      before,
      "not on the record yet"
    );

    assert.equal(
      (await editor(`/api/survey-updates/${proposal.id}/approve`, { method: "POST", body: {} })).status,
      200
    );
    assert.equal(await prisma.photo.count({ where: { partnerId: partner.id } }), before + 1);
    assert.equal(
      await prisma.surveyUpload.count({ where: { partnerId: partner.id } }),
      0,
      "the held copy is removed"
    );
  });

  test("a rejected photo is deleted", async () => {
    const photoQ = questions.find((q) => q.kind === "photo");
    const { token, tokenHash, expiresAt } = newInviteToken();
    await prisma.surveyInvite.update({
      where: { surveyId_partnerId: { surveyId: survey.id, partnerId: partner.id } },
      data: { tokenHash, expiresAt },
    });
    await anon(`/api/public/survey-uploads/${token}/${photoQ.id}`, {
      method: "POST",
      body: { contentType: "image/png", data: PNG.toString("base64") },
    });
    await anon(`/api/public/surveys/${token}/submit`, { method: "POST", body: { answers: [] } });
    const proposal = (await pending()).find((u) => u.field === "photo");
    assert.ok(proposal);
    assert.equal((await editor(`/api/survey-updates/${proposal.id}/reject`, { method: "POST" })).status, 200);
    assert.equal(await prisma.surveyUpload.count({ where: { partnerId: partner.id } }), 0);
  });

  test("the whole thing is 404 while the feature is off", async () => {
    await setFeatures({ surveys: false });
    assert.equal((await editor("/api/survey-updates")).status, 404);
    assert.equal((await editor("/api/surveys/templates")).status, 404);
    await setFeatures({ surveys: true });
  });
});
