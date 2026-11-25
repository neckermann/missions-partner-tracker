// An imported survey pack and the approve-and-update flow (#419): a survey built from a pack, answers
// that differ from the record becoming proposed changes (never edits), a person approving
// (optionally editing), rejecting or finding it already decided, and a partner's photo waiting for
// approval before it reaches the record.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
require("dotenv").config({ quiet: true });
const prisma = require("../../src/prismaClient");
const { newInviteToken } = require("../../src/utils/surveys");
const { readPackFile } = require("../../src/utils/packFiles");
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

describe("survey packs and updates", () => {
  test("an example survey pack imports as an ordinary editable draft survey", async () => {
    const pack = readPackFile("survey-annual-update");
    assert.equal(
      (await viewer("/api/template-packs/import", { method: "POST", body: { pack } })).status,
      403
    );
    const made = await admin("/api/template-packs/import", {
      method: "POST",
      body: { pack: { ...pack, data: { survey: { ...pack.data.survey, title: `${FIXTURE_TAG} Annual` } } } },
    });
    assert.equal(made.status, 200);
    survey = (await editor(`/api/surveys/${made.body.surveyId}`)).body;
    questions = survey.questions;
    assert.equal(survey.status, "draft");
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

  test("the bell: review items only for people who can approve; new answers for everyone who can see the partner", async () => {
    const keys = async (who) => (await who("/api/notifications/summary")).body.categories.map((c) => c.key);
    assert.ok((await keys(editor)).includes("surveyUpdatesPending"));
    assert.ok((await keys(admin)).includes("surveyUpdatesPending"));
    assert.ok(!(await keys(viewer)).includes("surveyUpdatesPending"), "a viewer can't act on it");
    const answers = (await viewer("/api/notifications/summary")).body.categories.find(
      (c) => c.key === "newSurveyResponses"
    );
    assert.ok(answers && answers.count >= 1, "a submitted survey counts as new");
    assert.equal(answers.isNew, true);
    await editor("/api/notifications/seen", { method: "POST", body: { category: "newSurveyResponses" } });
    const after = (await editor("/api/notifications/summary")).body.categories.find(
      (c) => c.key === "newSurveyResponses"
    );
    assert.equal(after.count, 0, "looking clears it for that person only");
    const still = (await viewer("/api/notifications/summary")).body.categories.find(
      (c) => c.key === "newSurveyResponses"
    );
    assert.ok(still.count >= 1);
  });

  test("the whole thing is 404 while the feature is off", async () => {
    await setFeatures({ surveys: false });
    assert.equal((await editor("/api/survey-updates")).status, 404);
    assert.equal((await admin("/api/template-packs/export/survey")).status, 404);
    await setFeatures({ surveys: true });
  });

  test("a mailing address answer becomes a proposal and, once approved, the partner's mailing address", async () => {
    const made = await editor("/api/surveys", { method: "POST", body: { title: `${FIXTURE_TAG} Address` } });
    const addrSurvey = made.body;
    const saved = await editor(`/api/surveys/${addrSurvey.id}/questions`, {
      method: "PUT",
      body: { questions: [{ kind: "address", label: "Where do you get mail?", field: "mailingAddress" }] },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.questions[0].field, "mailingAddress", "a link set in the builder is kept");
    assert.equal(
      (await editor(`/api/surveys/${addrSurvey.id}`, { method: "PUT", body: { status: "open" } })).status,
      200
    );
    const q = (await editor(`/api/surveys/${addrSurvey.id}`)).body.questions[0];
    const path = `/api/surveys/${addrSurvey.id}/partner/${partner.id}`;
    const answer = (value) => ({ submit: true, answers: [{ questionId: q.id, value }] });

    const bad = await editor(path, { method: "PUT", body: answer("not json") });
    assert.equal(bad.status, 400);

    const mine = async () =>
      (await editor("/api/survey-updates")).body.updates.filter(
        (u) => u.partnerId === partner.id && u.field === "mailingAddress"
      );
    const given = JSON.stringify({ line2: " ", city: "Lafayette ", line1: "12 Main St", region: "LA" });
    assert.equal((await editor(path, { method: "PUT", body: answer(given) })).status, 200);
    const [proposal] = await mine();
    assert.deepEqual(JSON.parse(proposal.proposedValue), {
      line1: "12 Main St",
      city: "Lafayette",
      region: "LA",
    });
    assert.equal(
      await prisma.address.count({ where: { partnerId: partner.id, type: "mailing" } }),
      0,
      "nothing is applied until someone approves"
    );

    const needsStreet = await editor(`/api/survey-updates/${proposal.id}/approve`, {
      method: "POST",
      body: { value: JSON.stringify({ city: "Lafayette" }) },
    });
    assert.equal(needsStreet.status, 400);
    const approved = await editor(`/api/survey-updates/${proposal.id}/approve`, {
      method: "POST",
      body: {
        value: JSON.stringify({ line1: "12 Main St", city: "Lafayette", region: "LA", postal: "70501" }),
      },
    });
    assert.equal(approved.status, 200);
    const mailing = await prisma.address.findUnique({
      where: { partnerId_type: { partnerId: partner.id, type: "mailing" } },
    });
    assert.equal(mailing.addressLine1, "12 Main St");
    assert.equal(mailing.postalCode, "70501");

    // The same address again matches what is on file, so nothing more is proposed.
    const same = JSON.stringify({ postal: "70501", region: "LA", city: "Lafayette", line1: "12 Main St" });
    await editor(path, { method: "PUT", body: answer(same) });
    assert.equal((await mine()).length, 0);
  });

  test("a support-preferences question shows the menu, proposes only what differs, and approving fills the record", async () => {
    const made = (body) => admin("/api/support-preferences/options", { method: "POST", body });
    await prisma.supportOption.deleteMany({ where: { group: `${FIXTURE_TAG} menu` } });
    const group = `${FIXTURE_TAG} menu`;
    const visit = (await made({ group, label: "A visit", kind: "offer" })).body;
    const days = (
      await made({
        group,
        label: "Best days",
        kind: "multiple",
        choices: ["Mon", "Tue", "Wed"],
        allowOther: false,
      })
    ).body;
    const staff = (await made({ group, label: "Staff note", kind: "text", staffOnly: true })).body;
    const retired = (await made({ group, label: "Old option", kind: "offer", active: false })).body;

    await setFeatures({ supportPreferences: false });
    const survey2 = (
      await editor("/api/surveys", { method: "POST", body: { title: `${FIXTURE_TAG} Support` } })
    ).body;
    const body = { questions: [{ kind: "support", label: "How can we support you?" }] };
    assert.equal(
      (await editor(`/api/surveys/${survey2.id}/questions`, { method: "PUT", body })).status,
      400,
      "needs Support preferences on"
    );
    await setFeatures({ supportPreferences: true });
    const saved = await editor(`/api/surveys/${survey2.id}/questions`, { method: "PUT", body });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.questions[0].field, "supportPreferences", "linked automatically");
    await editor(`/api/surveys/${survey2.id}`, { method: "PUT", body: { status: "open" } });
    const q = saved.body.questions[0];

    // The menu a partner sees leaves out a staff-only and a retired option.
    const { token, tokenHash, expiresAt } = newInviteToken();
    await prisma.surveyInvite.create({
      data: { surveyId: survey2.id, partnerId: partner.id, tokenHash, expiresAt, sentAt: new Date() },
    });
    const view = await anon(`/api/public/surveys/${token}`);
    const shown = view.body.supportMenu.map((o) => o.id);
    assert.ok(shown.includes(visit.id) && shown.includes(days.id));
    assert.ok(!shown.includes(staff.id) && !shown.includes(retired.id));

    const path = `/api/surveys/${survey2.id}/partner/${partner.id}`;
    const answer = (map) => ({ submit: true, answers: [{ questionId: q.id, value: JSON.stringify(map) }] });
    assert.equal(
      (await editor(path, { method: "PUT", body: answer({ [staff.id]: { text: "x" } }) })).status,
      400,
      "a staff-only option can't be answered"
    );
    assert.equal(
      (await editor(path, { method: "PUT", body: answer({ [days.id]: { choices: ["Fri"] } }) })).status,
      400,
      "a choice that isn't offered is refused"
    );

    // A staff note already on the record is kept when an answer is applied.
    await prisma.partnerSupportPreference.create({
      data: {
        partnerId: partner.id,
        optionId: days.id,
        selected: true,
        choices: ["Mon"],
        note: "Call first",
      },
    });
    const mine = async () =>
      (await editor("/api/survey-updates")).body.updates.filter(
        (u) => u.partnerId === partner.id && u.field === "supportPreferences"
      );
    const given = { [visit.id]: { selected: true }, [days.id]: { choices: ["Tue", "Mon"] } };
    assert.equal((await editor(path, { method: "PUT", body: answer(given) })).status, 200);
    const [proposal] = await mine();
    assert.match(proposal.proposedDisplay, /A visit/);
    assert.match(proposal.proposedDisplay, /Best days: Mon, Tue/);
    assert.match(proposal.currentDisplay, /Best days: Mon/);
    assert.equal(
      await prisma.partnerSupportPreference.count({ where: { partnerId: partner.id, optionId: visit.id } }),
      0,
      "nothing is applied until someone approves"
    );

    assert.equal(
      (await editor(`/api/survey-updates/${proposal.id}/approve`, { method: "POST", body: {} })).status,
      200
    );
    const prefs = await prisma.partnerSupportPreference.findMany({ where: { partnerId: partner.id } });
    assert.equal(prefs.find((p) => p.optionId === visit.id).selected, true);
    const dayRow = prefs.find((p) => p.optionId === days.id);
    assert.deepEqual([...dayRow.choices].sort(), ["Mon", "Tue"]);
    assert.equal(dayRow.note, "Call first", "the staff note is kept");

    // The same answers again match the record, so nothing more is proposed.
    await editor(path, { method: "PUT", body: answer(given) });
    assert.equal((await mine()).length, 0);
    // A change to one option proposes only that option.
    await editor(path, { method: "PUT", body: answer({ ...given, [days.id]: { choices: ["Wed"] } }) });
    const [again] = await mine();
    assert.doesNotMatch(again.proposedDisplay, /A visit/);
    assert.match(again.proposedDisplay, /Wed/);

    await prisma.supportOption.deleteMany({ where: { group } });
  });
});
