#!/usr/bin/env node
// A throwaway Postgres for running the tests locally.
//
// The route tests and the Playwright suite both need a real database --
// they boot the actual app and exercise the real middleware chain, which is
// the point of them. Until now that meant pointing DATABASE_URL at a cloud
// database, which is awkward (you need credentials before you can run a
// test) and risky (it is one typo away from running the suite, which
// creates and deletes users and partners, against something real).
//
// This runs the same postgres:16 image CI uses, on port 5433 so it cannot
// collide with a Postgres you already have on 5432.
//
// Usage:
//   npm run test:db up     start it, apply migrations, seed, create an admin
//   npm run test:db down   stop and delete it (all data goes with it)
//   npm run test:db url    print the DATABASE_URL to use

const { execFileSync } = require("child_process");
const path = require("path");

const CONTAINER = "missions-tracker-test-db";
const PORT = 5433;
const USER = "test";
const PASSWORD = "test";
const DB = "missions_tracker_test";
const IMAGE = "postgres:16";

const DATABASE_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}`;

// Credentials for the admin the suite logs in as. These match the defaults
// in frontend/e2e/helpers.js, so `npx playwright test` needs no extra env.
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo@missionspartnertracker.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "TryTheDemo2026!";

const BACKEND = path.join(__dirname, "..", "backend");

function docker(args, opts = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...opts }).trim();
}

function dockerQuiet(args) {
  try {
    return docker(args, { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function requireDocker() {
  if (dockerQuiet(["version", "--format", "{{.Server.Version}}"])) return;
  console.error(
    [
      "",
      "Docker isn't running.",
      "",
      "Start Docker Desktop and try again. If you'd rather not use Docker, set",
      "DATABASE_URL to any Postgres 13+ you can reach and skip this script --",
      "nothing here is Docker-specific, it's just a database.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

function containerState() {
  const out = dockerQuiet(["inspect", "-f", "{{.State.Status}}", CONTAINER]);
  return out || "absent";
}

function run(cmd, args, env) {
  execFileSync(cmd, args, {
    cwd: BACKEND,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL, ...env },
    shell: process.platform === "win32",
  });
}

async function waitForReady() {
  process.stdout.write("waiting for postgres");
  for (let i = 0; i < 60; i++) {
    // pg_isready inside the container: no client tools needed on the host.
    if (dockerQuiet(["exec", CONTAINER, "pg_isready", "-U", USER, "-d", DB]) !== null) {
      console.log(" ready");
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("\npostgres never became ready. `docker logs " + CONTAINER + "` will say why.");
  process.exit(1);
}

async function up() {
  requireDocker();

  const state = containerState();
  if (state === "running") {
    console.log(`${CONTAINER} is already running.`);
  } else {
    if (state !== "absent") {
      console.log(`removing a stopped ${CONTAINER}...`);
      dockerQuiet(["rm", "-f", CONTAINER]);
    }
    console.log(`starting ${IMAGE} on port ${PORT}...`);
    docker([
      "run",
      "--detach",
      "--name",
      CONTAINER,
      "--env",
      `POSTGRES_USER=${USER}`,
      "--env",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "--env",
      `POSTGRES_DB=${DB}`,
      "--publish",
      `${PORT}:5432`,
      IMAGE,
    ]);
    await waitForReady();
  }

  console.log("\napplying migrations...");
  run("npx", ["prisma", "migrate", "deploy"]);

  console.log("\nseeding...");
  run("node", ["prisma/seed.js"]);

  console.log("\ncreating the admin the tests log in as...");
  run("node", ["prisma/createAdmin.js", ADMIN_EMAIL, ADMIN_PASSWORD]);

  console.log(
    [
      "",
      "Ready. Put this in backend/.env (or export it):",
      "",
      `  DATABASE_URL="${DATABASE_URL}"`,
      "",
      "Then:",
      "  cd backend  && npm run test:routes",
      "  cd backend  && NODE_ENV=test node src/server.js",
      "  cd frontend && npx playwright test",
      "",
      `Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`,
      "",
      "`npm run test:db down` deletes the container and everything in it.",
      "",
    ].join("\n")
  );
}

function down() {
  requireDocker();
  if (containerState() === "absent") {
    console.log(`${CONTAINER} isn't there.`);
    return;
  }
  dockerQuiet(["rm", "-f", CONTAINER]);
  console.log(`removed ${CONTAINER} and its data.`);
}

const command = process.argv[2] || "up";

if (command === "up") {
  up();
} else if (command === "down") {
  down();
} else if (command === "url") {
  console.log(DATABASE_URL);
} else {
  console.error(`Unknown command "${command}". Use: up | down | url`);
  process.exit(1);
}
