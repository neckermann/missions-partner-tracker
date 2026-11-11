// Triggers this deployment's own POST /api/demo/reset -- the Start Command
// for both demo-reset cron jobs (dev-test and the production demo), each
// pointed at its own instance via RESET_URL/DEMO_RESET_TOKEN env vars set
// directly on that cron job in Render.
//
// Lives here, in version control, instead of as an inline `node -e "..."`
// string typed into Render's dashboard -- a cron job's Start Command isn't
// something `render.yaml` actually syncs (see demo/render.yaml's own
// header comment), so an inline string is the one part of this whole
// pipeline that isn't reviewable in a PR and can silently drift from
// what's actually configured. A real file can't drift the same way --
// reads `yarn trigger-remote-reset` in both Render dashboards, always
// runs exactly what's committed here.
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
