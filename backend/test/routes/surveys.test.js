// Partner surveys (#419). Covers the feature gate (404 when Surveys or Care teams is off), who
// builds and who fills in (a viewer reads nothing), that opening needs a question, how each kind
// of answer is validated and stored, required questions at submit, the personal link (works with
// no login, saves and submits, and answers identically for an unknown, expired or closed link),
// and that a send refuses without outbound email.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { hashToken, newInviteToken } = require("../../src/utils/surveys");
const { client, stopServer, ensureTestUsers, removeFixturePartners, FIXTURE_TAG } = require("./helpers");

const TITLE = `${FIXTURE_TAG} Check-in`;
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

async function cleanup() {
  await prisma.survey.deleteMany({ where: { title: { startsWith: FIXTURE_TAG } } });
  await removeFixturePartners();
}

before(async () => {
  await ensureTestUsers();
  admin = await client("admin");
  editor = await client("editor");
  viewer = await client("viewer");
  anon = await client(null);
  await cleanup();
  const settings = await prisma.churchSettings.findUnique({
    where: { id: "singleton" },
    select: { enabledFeatures: true },
  });
  originalEnabledFeatures = settings?.enabledFeatures ?? {};
  await setFeatures({ surveys: true, careTeam: true, outboundEmail: false });
  partner = (
    await admin("/api/partners", {
      method: "POST",
      body: { kind: "missionary", displayName: `${FIXTURE_TAG} surveyP` },
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

describe("surveys", () => {
  test("404 while the feature is off, and the public link too", async () => {
    await setFeatures({ surveys: false });
    assert.equal((await admin("/api/surveys")).status, 404);
    assert.equal((await anon("/api/public/surveys/" + "x".repeat(40))).status, 404);
    await setFeatures({ surveys: true });
    assert.equal((await admin("/api/surveys")).status, 200);
    // Surveys don't depend on Care teams: they keep working with it off.
    await setFeatures({ careTeam: false });
    assert.equal((await admin("/api/surveys")).status, 200);
    assert.equal((await admin("/api/survey-updates")).status, 200);
    assert.equal((await anon("/api/public/surveys/" + "x".repeat(40))).status, 404); // unknown token, not "feature off"
    await setFeatures({ careTeam: true });
  });

  test("an editor builds; a viewer can't; opening needs a question", async () => {
    assert.equal((await viewer("/api/surveys")).status, 403);
    const made = await editor("/api/surveys", {
      method: "POST",
      body: { title: TITLE, intro: "A few questions" },
    });
    assert.equal(made.status, 201);
    survey = made.body;
    const early = await editor(`/api/surveys/${survey.id}`, { method: "PUT", body: { status: "open" } });
    assert.equal(early.status, 400);

    const bad = await editor(`/api/surveys/${survey.id}/questions`, {
      method: "PUT",
      body: { questions: [{ kind: "single", label: "Pick" }] },
    });
    assert.equal(bad.status, 400, "a choice question needs choices or an other box");

    const saved = await editor(`/api/surveys/${survey.id}/questions`, {
      method: "PUT",
      body: {
        questions: [
          { kind: "text", label: "How are you?", required: true },
          { kind: "yesno", label: "Home this year?" },
          { kind: "single", label: "Best day", choices: ["Mon", "Tue"], allowOther: true },
          { kind: "multiple", label: "Needs", choices: ["Prayer", "Visit"] },
        ],
      },
    });
    assert.equal(saved.status, 200);
    questions = saved.body.questions;
    assert.equal(questions.length, 4);
    assert.equal(
      (await editor(`/api/surveys/${survey.id}`, { method: "PUT", body: { status: "open" } })).status,
      200
    );
  });

  test("staff fill in for a partner: validation, required at submit, viewer refused", async () => {
    const [how, home, day, needs] = questions;
    const path = `/api/surveys/${survey.id}/partner/${partner.id}`;
    assert.equal((await viewer(path, { method: "PUT", body: { answers: [], submit: false } })).status, 403);
    const wrong = await editor(path, {
      method: "PUT",
      body: { answers: [{ questionId: day.id, value: "Fri" }] },
    });
    assert.equal(wrong.status, 400);
    const both = await editor(path, {
      method: "PUT",
      body: { answers: [{ questionId: day.id, value: "Mon", other: "Sat" }] },
    });
    assert.equal(both.status, 400);

    const missing = await editor(path, {
      method: "PUT",
      body: { answers: [{ questionId: home.id, value: "yes" }], submit: true },
    });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /How are you\?/);

    const ok = await editor(path, {
      method: "PUT",
      body: {
        answers: [
          { questionId: how.id, value: "Doing well" },
          { questionId: home.id, value: "yes" },
          { questionId: day.id, other: "Saturday" },
          { questionId: needs.id, values: ["Prayer", "Visit"] },
        ],
        submit: true,
      },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.submitted, true);

    const read = await editor(`/api/surveys/partner/${partner.id}`);
    assert.equal(read.status, 200);
    const mine = read.body.surveys.find((s) => s.id === survey.id);
    assert.equal(mine.response.answers.length, 4);
    assert.ok(mine.response.enteredByName, "records who entered it");
    assert.equal(mine.response.answers.find((a) => a.label === "Needs").values.length, 2);
    assert.equal((await viewer(`/api/surveys/partner/${partner.id}`)).status, 200);
  });

  test("answers keep their question wording when a question is reworded or removed", async () => {
    const kept = questions.slice(0, 3).map((q, i) => ({
      id: q.id,
      kind: q.kind,
      label: i === 0 ? "How have you been?" : q.label,
      choices: q.choices,
      allowOther: q.allowOther,
      required: q.required,
    }));
    await editor(`/api/surveys/${survey.id}/questions`, { method: "PUT", body: { questions: kept } });
    const read = await editor(`/api/surveys/${survey.id}/responses`);
    const answers = read.body.responses[0].answers;
    assert.ok(
      answers.some((a) => a.label === "Needs" && a.questionId === null),
      "removed question's answer stays"
    );
    questions = (await editor(`/api/surveys/${survey.id}`)).body.questions;
  });

  test("reopening lets the response change again", async () => {
    const r = await editor(`/api/surveys/${survey.id}/partner/${partner.id}/reopen`, { method: "POST" });
    assert.equal(r.status, 200);
    const read = await editor(`/api/surveys/partner/${partner.id}`);
    assert.equal(read.body.surveys[0].response.submittedAt, null);
  });

  test("the personal link: no login, saves, submits; unknown, expired and closed links look the same", async () => {
    const other = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} surveyQ` },
      })
    ).body;
    const { token, tokenHash, expiresAt } = newInviteToken();
    await prisma.surveyInvite.create({
      data: { surveyId: survey.id, partnerId: other.id, tokenHash, expiresAt, sentAt: new Date() },
    });
    const first = await anon(`/api/public/surveys/${token}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.title, TITLE);
    assert.equal(first.body.questions.length, 3);
    assert.ok(!JSON.stringify(first.body).includes(other.displayName), "no partner data on the page");

    const q0 = first.body.questions[0];
    const early = await anon(`/api/public/surveys/${token}/submit`, {
      method: "POST",
      body: { answers: [] },
    });
    assert.equal(early.status, 400, "required question blocks submit");
    const draft = await anon(`/api/public/surveys/${token}`, {
      method: "PUT",
      body: { answers: [{ questionId: q0.id, value: "Fine" }] },
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.submitted, false);
    const back = await anon(`/api/public/surveys/${token}`);
    assert.equal(back.body.answers[0].value, "Fine");
    const done = await anon(`/api/public/surveys/${token}/submit`, { method: "POST", body: { answers: [] } });
    assert.equal(done.status, 200);
    assert.equal(done.body.submitted, true);

    const unknown = await anon("/api/public/surveys/" + "z".repeat(43));
    await prisma.surveyInvite.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await anon(`/api/public/surveys/${token}`);
    assert.equal(expired.status, 404);
    assert.deepEqual(expired.body, unknown.body);

    await prisma.surveyInvite.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });
    await editor(`/api/surveys/${survey.id}`, { method: "PUT", body: { status: "closed" } });
    const closed = await anon(`/api/public/surveys/${token}`);
    assert.deepEqual(closed.body, unknown.body);
    assert.equal(hashToken(token), tokenHash);
    await editor(`/api/surveys/${survey.id}`, { method: "PUT", body: { status: "open" } });
  });

  test("'save and finish later' keeps the valid answers and says which it could not keep; submit stays all-or-nothing", async () => {
    const mate = (
      await admin("/api/partners", {
        method: "POST",
        body: { kind: "missionary", displayName: `${FIXTURE_TAG} surveyR` },
      })
    ).body;
    const { token, tokenHash, expiresAt } = newInviteToken();
    await prisma.surveyInvite.create({
      data: { surveyId: survey.id, partnerId: mate.id, tokenHash, expiresAt, sentAt: new Date() },
    });
    const form = (await anon(`/api/public/surveys/${token}`)).body;
    const text = form.questions.find((q) => q.kind === "text");
    const day = form.questions.find((q) => q.kind === "single");
    const answers = [
      { questionId: text.id, value: "Doing well" },
      { questionId: day.id, value: "Not a day on the list" },
    ];

    const draft = await anon(`/api/public/surveys/${token}`, { method: "PUT", body: { answers } });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.saved, true);
    assert.equal(draft.body.skipped.length, 1);
    assert.equal(draft.body.skipped[0].questionId, day.id);
    assert.equal(draft.body.skipped[0].label, day.label);
    assert.ok(draft.body.skipped[0].error, "says why");
    const back = await anon(`/api/public/surveys/${token}`);
    assert.deepEqual(
      back.body.answers.map((a) => a.questionId),
      [text.id],
      "the valid answer was kept and the invalid one was not"
    );

    const strict = await anon(`/api/public/surveys/${token}/submit`, { method: "POST", body: { answers } });
    assert.equal(strict.status, 400, "submitting still refuses the whole thing");

    const clean = await anon(`/api/public/surveys/${token}`, {
      method: "PUT",
      body: { answers: [{ questionId: text.id, value: "Still well" }] },
    });
    assert.deepEqual(clean.body.skipped, []);
  });

  test("sending needs outbound email, and lists who can be reached", async () => {
    const send = await editor(`/api/surveys/${survey.id}/send`, {
      method: "POST",
      body: { partnerIds: [partner.id] },
    });
    assert.equal(send.status, 400);
    assert.match(send.body.error, /Email/);
    const rec = await editor(`/api/surveys/${survey.id}/recipients`);
    const row = rec.body.recipients.find((r) => r.partnerId === partner.id);
    assert.equal(row.canEmail, false);
    assert.equal(row.blockedReason, "no email on file");
  });

  test("a staff-made link opens the survey with no email, replaces the old one, and a viewer can't make one", async () => {
    const before = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://church.example.org";
    try {
      const other = (
        await admin("/api/partners", {
          method: "POST",
          body: { kind: "missionary", displayName: `${FIXTURE_TAG} linkP` },
        })
      ).body;
      assert.equal(
        (await viewer(`/api/surveys/${survey.id}/link`, { method: "POST", body: { partnerId: other.id } }))
          .status,
        403
      );
      const first = await editor(`/api/surveys/${survey.id}/link`, {
        method: "POST",
        body: { partnerId: other.id },
      });
      assert.equal(first.status, 200);
      assert.match(first.body.url, /^https:\/\/church\.example\.org\/survey\//);
      const token1 = decodeURIComponent(first.body.url.split("/survey/")[1]);
      assert.equal((await anon(`/api/public/surveys/${token1}`)).status, 200);

      const second = await editor(`/api/surveys/${survey.id}/link`, {
        method: "POST",
        body: { partnerId: other.id },
      });
      const token2 = decodeURIComponent(second.body.url.split("/survey/")[1]);
      assert.equal(
        (await anon(`/api/public/surveys/${token1}`)).status,
        404,
        "the earlier link stops working"
      );
      assert.equal((await anon(`/api/public/surveys/${token2}`)).status, 200);

      const rec = await editor(`/api/surveys/${survey.id}/recipients`);
      const row = rec.body.recipients.find((r) => r.partnerId === other.id);
      assert.equal(row.canLink, true);
      assert.equal(row.state, "invited");
    } finally {
      if (before === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = before;
    }
  });

  test("only an admin deletes a survey", async () => {
    assert.equal((await editor(`/api/surveys/${survey.id}`, { method: "DELETE" })).status, 403);
    assert.equal((await admin(`/api/surveys/${survey.id}`, { method: "DELETE" })).status, 200);
  });
});
