// The only module that touches the WhatsApp (Baileys) socket; everything else
// uses the API exported at the bottom, so nothing bypasses the anti-ban wrapper.
//
// This is an UNOFFICIAL linked-device connection and WhatsApp can ban such
// numbers: use a dedicated number (see the admin guide), and every send goes
// through baileys-antiban's wrapSocket (rate limits, jitter, duplicate
// blocking, health monitor).
//
// Exactly one process may hold the session (two sockets on one session log it
// out) and deploys briefly overlap old and new instances, so the session is
// opened only by the process holding a Postgres advisory lock on a dedicated
// connection; the other retries until the old instance releases it on SIGTERM.
//
// `baileys` is ESM and this backend is CommonJS, hence dynamic import(). State
// is module-level: one WhatsApp session per instance (ChurchSettings is a singleton).
const QRCode = require("qrcode");
const { Client } = require("pg");
const prisma = require("../prismaClient");
const { parseDatabaseUrl } = require("./databaseUrl");
const { isGuardedDemoInstance } = require("./demoMode");
const { useDbAuthState, clearAuthState } = require("./whatsappAuthState");

// Fixed: every instance must use the same number to contend for the same lock.
const ADVISORY_LOCK_KEY = "7204117101";
const LOCK_RETRY_MS = 15 * 1000;
const PAIRING_TIMEOUT_MS = 3 * 60 * 1000; // abandoned pairing screens stop generating QRs
const MAX_RECONNECT_DELAY_MS = 60 * 1000;
// Right after a deploy a read can briefly show "no registered session" while the
// old instance still holds the lock; only the Nth consecutive unregistered read
// (with a reconnect wait between) is trusted as genuinely gone.
const UNREGISTERED_WIPE_THRESHOLD = 3;

// Seam for tests; production uses real Baileys, lock and timers.
const deps = {
  loadBaileys: () => import("baileys"),
  loadAntiban: () => require("baileys-antiban"),
  acquireLock: acquireAdvisoryLock,
  releaseLock: releaseAdvisoryLock,
  fetchVersion: null, // set below; null in tests means "don't hit the network"
};

const runtime = {
  // disconnected | connecting | pairing | connected | locked_elsewhere | logged_out
  status: "disconnected",
  rawSock: null,
  sock: null, // anti-ban-wrapped; the only thing sendText() touches
  wantConnected: false,
  connecting: false,
  qrDataUrl: null,
  // True only while an admin has started a pairing from the UI. A connect() with
  // no registered session and this unset means the session is gone (e.g. settings
  // restored from a backup; the session table is never backed up).
  pairingRequested: false,
  lastError: null,
  // Bumped on every real connect() attempt. handleLoggedOut() checks it again
  // after its awaits so a stale cleanup can't wipe what a newer attempt wrote.
  generation: 0,
  attempts: 0,
  // Consecutive connect() attempts that found no registered session; see UNREGISTERED_WIPE_THRESHOLD.
  unregisteredStreak: 0,
  reconnectTimer: null,
  pairingTimer: null,
  lockClient: null,
};

// Baileys requires a pino-shaped logger. Silent on purpose: debug output
// includes message traffic, and message bodies must never reach the logs.
function makeSilentLogger() {
  const logger = {
    level: "silent",
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  return logger;
}

// Bound the TCP handshake so a hung connection can't block indefinitely.
const LOCK_CONNECT_TIMEOUT_MS = 10 * 1000;

async function acquireAdvisoryLock() {
  if (runtime.lockClient) return true;
  const client = new Client({
    ...parseDatabaseUrl(process.env.DATABASE_URL),
    connectionTimeoutMillis: LOCK_CONNECT_TIMEOUT_MS,
  });
  // An unhandled 'error' on a pg client crashes the process. A dropped connection
  // loses the lock, so stop using the session rather than risk two holders.
  client.on("error", (err) => {
    console.error("WhatsApp lock connection error:", err.message);
    if (runtime.lockClient === client) {
      runtime.lockClient = null;
      stopSocket();
      runtime.status = "disconnected";
      if (runtime.wantConnected) scheduleReconnect(LOCK_RETRY_MS);
    }
  });
  await client.connect();
  const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [ADVISORY_LOCK_KEY]);
  if (!rows[0].locked) {
    await client.end().catch(() => {});
    return false;
  }
  runtime.lockClient = client;
  return true;
}

async function releaseAdvisoryLock() {
  const client = runtime.lockClient;
  runtime.lockClient = null;
  // Closing the connection releases a session-level advisory lock.
  if (client) await client.end().catch(() => {});
}

function clearTimers() {
  clearTimeout(runtime.reconnectTimer);
  clearTimeout(runtime.pairingTimer);
  runtime.reconnectTimer = null;
  runtime.pairingTimer = null;
}

function stopSocket() {
  const sock = runtime.rawSock;
  runtime.rawSock = null;
  runtime.sock = null;
  if (sock) {
    try {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.end(undefined);
    } catch {
      // already closed
    }
  }
}

function scheduleReconnect(delayMs) {
  if (!runtime.wantConnected) return;
  clearTimeout(runtime.reconnectTimer);
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    connect().catch((err) => console.error("WhatsApp reconnect failed:", err.message));
  }, delayMs);
  // Never keep the process alive just to retry.
  runtime.reconnectTimer.unref?.();
}

function digitsFromJid(jid) {
  // "15551234567:12@s.whatsapp.net" -> "15551234567"
  return String(jid || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");
}

async function recordPaired(user) {
  const phone = digitsFromJid(user?.id) || null;
  const now = new Date();
  // Runs on every "open" (pairing and reconnects), so this also clears a prior
  // "connection dropped" state.
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", whatsappPairedAt: now, whatsappPhoneNumber: phone },
    update: {
      whatsappPairedAt: now,
      whatsappPhoneNumber: phone,
      whatsappLastError: null,
      whatsappDisconnectedAt: null,
    },
  });
}

// The session is gone for good (device unlinked or revoked): wipe local state
// and the "paired" markers the admin UI reads.
async function handleLoggedOut() {
  // Both a close event and unlink() can reach this for the same logout. If a new
  // connect()/startPairing() bumped this generation meanwhile, this cleanup is
  // stale and would wipe the new attempt's auth state.
  const generation = runtime.generation;
  runtime.wantConnected = false;
  runtime.pairingRequested = false;
  clearTimers();
  stopSocket();
  runtime.status = "logged_out";
  runtime.qrDataUrl = null;
  if (runtime.generation !== generation) return;
  try {
    await clearAuthState();
    if (runtime.generation !== generation) return;
    await prisma.churchSettings.updateMany({
      where: { id: "singleton" },
      data: { whatsappPairedAt: null, whatsappPhoneNumber: null },
    });
  } catch (err) {
    console.error("WhatsApp logout cleanup failed:", err.message);
  }
  if (runtime.generation !== generation) return;
  await deps.releaseLock();
}

async function handleConnectionUpdate(baileys, update) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    // Keep the QR spec's 4-module quiet zone; smaller can stop a phone locking
    // onto the finder patterns, especially from a monitor.
    runtime.qrDataUrl = await QRCode.toDataURL(qr, { margin: 4, width: 400 });
  }

  if (connection === "open") {
    runtime.status = "connected";
    runtime.attempts = 0;
    runtime.unregisteredStreak = 0;
    runtime.qrDataUrl = null;
    runtime.pairingRequested = false;
    runtime.lastError = null;
    clearTimeout(runtime.pairingTimer);
    try {
      await recordPaired(runtime.rawSock?.user);
    } catch (err) {
      console.error("Couldn't record the WhatsApp pairing:", err.message);
    }
  }

  if (connection === "close") {
    const code = lastDisconnect?.error?.output?.statusCode;
    runtime.sock = null;
    runtime.rawSock = null;
    if (code === baileys.DisconnectReason.loggedOut) {
      // WhatsApp revoked the linked device (admin removed it, or a conflicting
      // second connection during a deploy overlap).
      console.error(
        "WhatsApp logged this device out (DisconnectReason.loggedOut) -- clearing the saved session."
      );
      await handleLoggedOut();
      return;
    }
    if (!runtime.wantConnected) {
      runtime.status = "disconnected";
      return;
    }
    runtime.status = runtime.qrDataUrl ? "pairing" : "connecting";
    runtime.lastError = lastDisconnect?.error?.message || null;
    // 515 ("restart required") is expected right after pairing: reconnect immediately.
    const restart = code === baileys.DisconnectReason.restartRequired;
    runtime.attempts = restart ? 0 : runtime.attempts + 1;
    scheduleReconnect(restart ? 500 : Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** runtime.attempts));
  }
}

// Checked after every await in connect(): a concurrent disconnect()/unlink()
// only flips wantConnected and can't cancel an in-flight attempt. Releases the
// lock itself since the caller never reaches its own cleanup.
async function abortIfConnectionNoLongerWanted() {
  if (runtime.wantConnected) return false;
  await deps.releaseLock();
  runtime.status = "disconnected";
  return true;
}

async function connect() {
  runtime.wantConnected = true;
  if (runtime.rawSock || runtime.connecting) return;
  runtime.connecting = true;
  runtime.generation += 1;
  try {
    if (!(await deps.acquireLock())) {
      runtime.status = "locked_elsewhere";
      scheduleReconnect(LOCK_RETRY_MS);
      return;
    }
    if (await abortIfConnectionNoLongerWanted()) return;
    const baileys = await deps.loadBaileys();
    if (await abortIfConnectionNoLongerWanted()) return;
    const { wrapSocket } = deps.loadAntiban();
    const { state, saveCreds } = await useDbAuthState(baileys);
    if (await abortIfConnectionNoLongerWanted()) return;

    // creds.registered is NOT a reliable "session exists" signal: in this Baileys
    // version only the phone-number pairing-code path sets it, never QR pairing
    // (our only method). me.id is only set once an identity is linked and is
    // persisted for both methods.
    if (!state.creds.me?.id && !runtime.pairingRequested) {
      runtime.unregisteredStreak += 1;
      if (runtime.unregisteredStreak < UNREGISTERED_WIPE_THRESHOLD) {
        // Might be a deploy-restart race (see UNREGISTERED_WIPE_THRESHOLD): wait
        // and look again, releasing the lock so a stuck old instance isn't blocked.
        console.warn(
          `WhatsApp session not found (attempt ${runtime.unregisteredStreak}/${UNREGISTERED_WIPE_THRESHOLD}) -- retrying before treating it as gone.`
        );
        runtime.status = "connecting";
        await deps.releaseLock();
        scheduleReconnect(LOCK_RETRY_MS);
        return;
      }
      // Still no session after repeated attempts: don't open a socket that only
      // emits unscanned QR codes; clear paired markers so the admin UI offers pairing.
      console.error(
        `WhatsApp session still not found after ${runtime.unregisteredStreak} attempts -- treating it as gone.`
      );
      await handleLoggedOut();
      return;
    }
    runtime.unregisteredStreak = 0;

    let version;
    if (deps.fetchVersion) {
      try {
        version = (await deps.fetchVersion(baileys)).version;
      } catch {
        // Baileys' bundled default is fine if GitHub is unreachable.
      }
    }

    const makeSocket = baileys.default || baileys.makeWASocket;
    const rawSock = makeSocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: makeSilentLogger(),
      browser: baileys.Browsers.ubuntu("Missions Partner Tracker"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    runtime.rawSock = rawSock;
    runtime.sock = wrapSocket(rawSock, {
      preset: "conservative",
      logging: false,
      autoPauseAt: "high",
      onRiskChange: (health) => {
        console.warn(`WhatsApp ban-risk level is now "${health.risk}".`);
      },
    });
    runtime.status = state.creds.registered ? "connecting" : "pairing";

    rawSock.ev.on("creds.update", saveCreds);
    rawSock.ev.on("connection.update", (update) => {
      handleConnectionUpdate(baileys, update).catch((err) =>
        console.error("WhatsApp connection handler failed:", err.message)
      );
    });
  } catch (err) {
    runtime.lastError = err.message;
    runtime.status = "disconnected";
    // Persisted so the in-app "WhatsApp connection drop" notification can read
    // it; recordPaired clears it on the next successful connect.
    await prisma.churchSettings
      .update({
        where: { id: "singleton" },
        data: { whatsappLastError: err.message, whatsappDisconnectedAt: new Date() },
      })
      .catch(() => {}); // best-effort -- a settings-write failure must never block the reconnect logic below
    stopSocket();
    scheduleReconnect(Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** ++runtime.attempts));
    throw err;
  } finally {
    runtime.connecting = false;
  }
}

// Keeps the socket in step with saved settings; called at startup and every
// scheduler tick.
async function syncWithSettings(settings, featureEnabled) {
  const shouldRun = Boolean(featureEnabled && settings?.whatsappPairedAt);
  if (runtime.status === "pairing" && runtime.wantConnected && !settings?.whatsappPairedAt) {
    return; // an admin is mid-pairing right now -- leave it alone
  }
  if (shouldRun) {
    if (!runtime.rawSock && !runtime.connecting && !runtime.reconnectTimer) {
      await connect().catch((err) => console.error("WhatsApp connect failed:", err.message));
    }
  } else if (runtime.wantConnected || runtime.rawSock) {
    await disconnect();
  }
}

// Starts pairing; the QR is read back by polling getStatus().
async function startPairing() {
  await disconnect(); // drop any half-finished earlier attempt
  runtime.pairingRequested = true;
  runtime.qrDataUrl = null;
  runtime.lastError = null;
  runtime.status = "pairing";
  await connect();
  clearTimeout(runtime.pairingTimer);
  runtime.pairingTimer = setTimeout(() => {
    if (runtime.status !== "connected") {
      disconnect().catch(() => {});
      runtime.lastError = "Pairing timed out -- start again.";
    }
  }, PAIRING_TIMEOUT_MS);
  runtime.pairingTimer.unref?.();
}

// Closes the socket and releases the lock WITHOUT touching the saved session.
async function disconnect() {
  runtime.wantConnected = false;
  clearTimers();
  stopSocket();
  runtime.status = "disconnected";
  runtime.qrDataUrl = null;
  runtime.pairingRequested = false;
  await deps.releaseLock();
}

// Unlinks for good: tells WhatsApp to drop this device, then wipes the stored session and paired markers.
async function unlink() {
  const sock = runtime.rawSock;
  if (sock) {
    try {
      await sock.logout();
    } catch {
      // Already disconnected -- the local cleanup below is what matters.
    }
  }
  await handleLoggedOut();
  runtime.status = "disconnected";
}

function getStatus() {
  let health = null;
  try {
    const stats = runtime.sock?.antiban?.getStats?.();
    if (stats?.health) health = { risk: stats.health.risk, recommendation: stats.health.recommendation };
  } catch {
    // stats are best-effort display only
  }
  return {
    status: runtime.status,
    qrDataUrl: runtime.qrDataUrl,
    error: runtime.lastError,
    health,
  };
}

function requireConnected() {
  if (!runtime.sock || !runtime.rawSock || runtime.status !== "connected") {
    throw new Error("WhatsApp isn't connected right now.");
  }
}

// The only send path. The anti-ban wrapper may delay it or reject it while the
// number is paused; callers treat a throw as "leave the row queued, retry".
//
// The third ({}) argument is required: baileys-antiban's wrapped sendMessage
// reads `options.circuitBreaker` unguarded, so a 2-argument call throws.
async function sendText(jid, text) {
  // A public demo sends nothing to a real number or group (utils/demoMode.js).
  if (await isGuardedDemoInstance()) {
    console.log("[demo] WhatsApp message not sent");
    return;
  }
  requireConnected();
  await runtime.sock.sendMessage(jid, { text }, {});
}

// Baileys' communityFetchAllParticipating() silently returns {} (it parses a
// wrapper the server never sends). Use groupFetchAllParticipating() filtered to isCommunity.
async function listCommunities() {
  requireConnected();
  const all = await runtime.rawSock.groupFetchAllParticipating();
  return Object.values(all || {})
    .filter((g) => g.isCommunity)
    .map((c) => ({ id: c.id, name: c.subject || "(unnamed community)" }));
}

async function listCommunityGroups(communityJid) {
  requireConnected();
  const result = await runtime.rawSock.communityFetchLinkedGroups(communityJid);
  return (result?.linkedGroups || [])
    .filter((g) => g.id)
    .map((g) => ({ id: g.id, name: g.subject || "(unnamed group)" }));
}

// Each community's built-in Announcements group (isCommunityAnnounce, linkedParent
// = community) is resolved automatically, never hand-picked.
async function findAnnouncementGroup(communityJid) {
  requireConnected();
  const all = await runtime.rawSock.groupFetchAllParticipating();
  const match = Object.values(all || {}).find(
    (g) => g.linkedParent === communityJid && g.isCommunityAnnounce
  );
  return match ? { id: match.id, name: match.subject || "(unnamed group)" } : null;
}

// Called from SIGTERM: release the lock promptly so the incoming instance can take over.
async function shutdown() {
  await disconnect();
}

// Real lookup of the current WhatsApp Web version (a stale one breaks connections); production only.
deps.fetchVersion = (baileys) => baileys.fetchLatestBaileysVersion();

module.exports = {
  syncWithSettings,
  startPairing,
  unlink,
  getStatus,
  sendText,
  listCommunities,
  listCommunityGroups,
  findAnnouncementGroup,
  shutdown,
  // exported for tests only
  _deps: deps,
  _runtime: runtime,
  _handleConnectionUpdate: handleConnectionUpdate,
  _digitsFromJid: digitsFromJid,
  _connect: connect,
};
