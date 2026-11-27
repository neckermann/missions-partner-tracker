import { test, expect } from "@playwright/test";
import { login, setFeatures, restoreFeatures } from "./helpers.js";

// A partner on a survey link chooses a big phone photo: the browser shrinks it before sending (prepareImage.js),
// so what goes over the wire is far smaller than the file they chose, and it is still accepted. Turns Surveys on
// (and Care teams, which the survey cards need) and cleans up the partner and survey it makes.
test.describe.configure({ mode: "serial" });

test("a big photo is shrunk in the browser before it is sent", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin);
  const previous = await setFeatures(admin.request, { careTeam: true, surveys: true });
  const stamp = Date.now();
  let partnerId;
  let surveyId;
  try {
    const partner = await (
      await admin.request.post("/api/partners", {
        data: {
          kind: "missionary",
          displayName: `E2E photo partner ${stamp}`,
          adults: [
            { firstName: "Pat", lastName: "Doe", email: `pat-${stamp}@example.test`, isPrimaryContact: true },
          ],
        },
      })
    ).json();
    partnerId = partner.id;
    const survey = await (
      await admin.request.post("/api/surveys", { data: { title: `E2E photo ${stamp}` } })
    ).json();
    surveyId = survey.id;
    const questions = await admin.request.put(`/api/surveys/${surveyId}/questions`, {
      data: { questions: [{ kind: "photo", label: "A recent photo" }] },
    });
    expect(questions.ok(), await questions.text()).toBeTruthy();
    await admin.request.put(`/api/surveys/${surveyId}`, { data: { status: "open" } });
    const link = await admin.request.post(`/api/surveys/${surveyId}/link`, { data: { partnerId } });
    expect(link.ok(), await link.text()).toBeTruthy();
    const { url } = await link.json();

    // The partner: no account, their own link.
    const partnerContext = await browser.newContext();
    const page = await partnerContext.newPage();
    // A 12-megapixel phone-sized JPEG, made in the browser (noise so it isn't tiny).
    const original = await page.evaluate(async () => {
      const W = 4032;
      const H = 3024;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d");
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#5aa0e6");
      sky.addColorStop(1, "#6b8f4e");
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `hsl(${Math.random() * 360},40%,50%)`;
        g.beginPath();
        g.arc(Math.random() * W, Math.random() * H, 20 + Math.random() * 150, 0, 7);
        g.fill();
      }
      const d = g.getImageData(0, 0, W, H);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 24;
        d.data[i] += n;
        d.data[i + 1] += n;
        d.data[i + 2] += n;
      }
      g.putImageData(d, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const buffer = Buffer.from(original, "base64");
    expect(buffer.length, "the test photo is big, like a phone's").toBeGreaterThan(3 * 1024 * 1024);

    await page.goto(new URL(url).pathname);
    const sent = page.waitForRequest(
      (r) => r.url().includes("/api/public/survey-uploads/") && r.method() === "POST"
    );
    await page
      .getByLabel("A recent photo")
      .setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer });
    const request = await sent;
    const body = JSON.parse(request.postData());
    const sentBytes = Buffer.from(body.data, "base64").length;
    expect(body.contentType).toBe("image/jpeg");
    expect(sentBytes, `sent ${sentBytes} bytes for a ${buffer.length} byte photo`).toBeLessThan(
      buffer.length / 2
    );
    await expect(page.getByText("Photo received")).toBeVisible();
    await partnerContext.close();
  } finally {
    if (surveyId) await admin.request.delete(`/api/surveys/${surveyId}`);
    if (partnerId) await admin.request.delete(`/api/partners/${partnerId}`);
    await restoreFeatures(admin.request, previous);
    await adminContext.close();
  }
});
