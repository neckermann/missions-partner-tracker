// Triggers this deployment's own POST /api/demo/reset: the Start Command for both demo-reset
// cron jobs (dev-test and the production demo), each pointed at its instance via
// RESET_URL/DEMO_RESET_TOKEN set on the cron job in Render.
//
// It lives in version control rather than as an inline `node -e` string in Render's dashboard,
// because a cron job's Start Command isn't synced by render.yaml (see demo/render.yaml) and an
// inline string can drift unreviewed. The dashboards read `yarn trigger-remote-reset`.
fetch(process.env.RESET_URL, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.DEMO_RESET_TOKEN}` },
})
  .then((res) => {
    if (!res.ok) {
      console.error("status", res.status);
      process.exit(1);
    }
    console.log("reset ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
