// The one place that touches the WhatsApp (Baileys) socket. Everything
// else -- whatsappChannel.js (scheduled posting), routes/settings.js
// (pairing and the pickers) -- goes through the small API exported at the
// bottom, so nothing outside this file ever calls sock.sendMessage
// directly (which would bypass the anti-ban wrapper below).
//
// This is an UNOFFICIAL connection: Baileys speaks the WhatsApp Web
// protocol as a linked device of a dedicated phone number. WhatsApp can
// ban such numbers, which is why (a) the admin guide insists on a
// dedicated number, never anyone's personal one, and (b) every send goes
// through baileys-antiban's wrapSocket -- rate limits, jittered delays,
// duplicate blocking, and a health monitor that refuses sends when the
// ban risk climbs. Our volume (a handful of messages a day) is far below
// even its most conservative caps, so in normal use the wrapper just adds
// human-like spacing.
//
// Runs inside the web service's own process (no extra Render service).
// Exactly one process may hold the WhatsApp session -- two sockets on one
// session fight each other and get it logged out -- and Render briefly
// runs the old and new instance side by side during every deploy. So the
// session is only opened by the process holding a Postgres advisory lock
// on a dedicated, long-lived connection; the other keeps retrying until
// the old instance exits (SIGTERM -> shutdown() below -> lock released).
//
// `baileys` is an ES module and this backend is CommonJS, hence the
// dynamic import(). All state is module-level because there is exactly one
// WhatsApp session per instance (ChurchSettings is a singleton).
const QRCode = require("qrcode");
const { Client } = require("pg");
const prisma = require("../prismaClient");
const { parseDatabaseUrl } = require("./databaseUrl");
const { useDbAuthState, clearAuthState } = require("./whatsappAuthState");

// Arbitrary but fixed: every instance of this app must use the same
// number so they contend for the same lock.
const ADVISORY_LOCK_KEY = "7204117101";
const LOCK_RETRY_MS = 15 * 1000;
const PAIRING_TIMEOUT_MS = 3 * 60 * 1000; // abandoned pairing screens stop generating QRs
const MAX_RECONNECT_DELAY_MS = 60 * 1000;

// Replaceable seam for tests -- production uses the real Baileys, the real
// advisory lock, and real timers.
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
  pairingCode: null,
  pairingPhone: null,
  // True only while an admin has actively started a pairing from the UI.
  // A connect() with no registered session and this unset means the
  // session is gone (e.g. settings restored from a backup onto a fresh
  // database -- the session table is deliberately never backed up).
  pairingRequested: false,
  lastError: null,
  // Bumped at the start of every real connect() attempt (see below).
  // handleLoggedOut() captures this before its own awaits and checks it
  // again after -- if a new connect()/pairing has started in the
  // meantime, this cleanup is for a session that's already superseded,
  // and must not wipe what the new attempt just wrote.
  generation: 0,
  attempts: 0,
  reconnectTimer: null,
  pairingTimer: null,
  lockClient: null,
};

// Baileys requires a pino-shaped logger. Silent on purpose: its debug
// output includes message traffic, and message bodies must never reach the
// logs (the admin guide promises this).
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

// ---- advisory lock ------------------------------------------------------

// A hung TCP handshake with no timeout would block indefinitely -- this
// is the one specific hang point the digestScheduler.js's own timeout
// wrapper can't distinguish from a hung Baileys handshake, so it's
// worth bounding here too as defense in depth.
const LOCK_CONNECT_TIMEOUT_MS = 10 * 1000;

async function acquireAdvisoryLock() {
  if (runtime.lockClient) return true;
  const client = new Client({
    ...parseDatabaseUrl(process.env.DATABASE_URL),
    connectionTimeoutMillis: LOCK_CONNECT_TIMEOUT_MS,
  });
  // Must be handled: an unhandled 'error' on a pg client crashes the
  // process. If the connection drops, the lock is gone with it, so stop
  // using the session rather than risk two holders.
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

// ---- socket lifecycle ---------------------------------------------------

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
  // Never keep the process alive just to retry a connection.
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
  await prisma.churchSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", whatsappPairedAt: now, whatsappPhoneNumber: phone },
    update: { whatsappPairedAt: now, whatsappPhoneNumber: phone },
  });
}

// The session is gone for good (the admin removed the linked device in
// WhatsApp, or WhatsApp revoked it): wipe local state so the next pairing
// starts clean, and clear the "paired" markers the admin UI reads.
async function handleLoggedOut() {
  // Both a "connection.update" close event (DisconnectReason.loggedOut)
  // and unlink()'s own explicit call can reach this function for the
  // same logout, close together in time. Captured once, up front: if a
  // NEW connect()/startPairing() has already bumped this by the time
  // this invocation actually gets to the destructive calls below, that
  // means a new session attempt is already underway and this cleanup is
  // stale -- proceeding would wipe the auth state or paired markers the
  // new attempt just wrote, out from under it.
  const generation = runtime.generation;
  runtime.wantConnected = false;
  runtime.pairingRequested = false;
  clearTimers();
  stopSocket();
  runtime.status = "logged_out";
  runtime.qrDataUrl = null;
  runtime.pairingCode = null;
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
    if (runtime.pairingPhone && !runtime.pairingCode && runtime.rawSock) {
      // Phone-number pairing: the socket is ready to request a code once
      // it has emitted its first QR.
      try {
        runtime.pairingCode = await runtime.rawSock.requestPairingCode(runtime.pairingPhone);
      } catch (err) {
        runtime.lastError = `Couldn't get a pairing code: ${err.message}`;
      }
    } else if (!runtime.pairingPhone) {
      // margin stays at the QR spec's recommended 4-module quiet zone --
      // shrinking it (an earlier version of this code used margin: 1) can
      // stop a phone camera from locking onto the finder patterns at all,
      // especially scanning off a monitor rather than a printed code.
      runtime.qrDataUrl = await QRCode.toDataURL(qr, { margin: 4, width: 400 });
    }
  }

  if (connection === "open") {
    runtime.status = "connected";
    runtime.attempts = 0;
    runtime.qrDataUrl = null;
    runtime.pairingCode = null;
    runtime.pairingPhone = null;
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
      await handleLoggedOut();
      return;
    }
    if (!runtime.wantConnected) {
      runtime.status = "disconnected";
      return;
    }
    runtime.status = runtime.pairingPhone || runtime.qrDataUrl ? "pairing" : "connecting";
    runtime.lastError = lastDisconnect?.error?.message || null;
    // 515 ("restart required") is expected right after a successful
    // pairing: reconnect immediately. Anything else backs off.
    const restart = code === baileys.DisconnectReason.restartRequired;
    runtime.attempts = restart ? 0 : runtime.attempts + 1;
    scheduleReconnect(restart ? 500 : Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** runtime.attempts));
  }
}

// Checked after every await inside connect() below. A concurrent
// disconnect()/unlink() that runs while connect() is mid-flight only
// flips runtime.wantConnected -- it can't cancel this already-in-progress
// attempt, so without this check connect() would finish and leave
// WhatsApp connected right after an admin explicitly disconnected it.
// Releases the lock itself if it had already been acquired, since the
// caller never reaches its own cleanup once this aborts early.
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

    if (!state.creds.registered && !runtime.pairingRequested) {
      // Settings say "paired" but there's no session to open: don't spin
      // up a socket that would just emit QR codes nobody is scanning.
      // Clear the paired markers so the admin UI offers pairing again.
      await handleLoggedOut();
      return;
    }

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
    stopSocket();
    scheduleReconnect(Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** ++runtime.attempts));
    throw err;
  } finally {
    runtime.connecting = false;
  }
}

// ---- public API -----------------------------------------------------------

// Keeps the live socket in step with the saved settings; called at startup
// and on every scheduler tick, so turning the feature off (or unlinking)
// closes the socket within a minute and turning it on / pairing opens it.
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

// Starts a pairing session. With a phone number, WhatsApp shows an
// 8-character code to type under Linked Devices > Link with phone number;
// without one, a QR code is produced instead. Either way the result is
// read back by polling getStatus().
async function startPairing({ phoneNumber } = {}) {
  await disconnect(); // drop any half-finished earlier attempt
  runtime.pairingRequested = true;
  runtime.pairingPhone = phoneNumber ? String(phoneNumber).replace(/\D/g, "") : null;
  runtime.pairingCode = null;
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

// Closes the socket and releases the lock WITHOUT touching the saved
// session -- used when the feature is turned off and at shutdown.
async function disconnect() {
  runtime.wantConnected = false;
  clearTimers();
  stopSocket();
  runtime.status = "disconnected";
  runtime.qrDataUrl = null;
  runtime.pairingCode = null;
  runtime.pairingPhone = null;
  runtime.pairingRequested = false;
  await deps.releaseLock();
}

// Unlinks for good: tells WhatsApp to drop this linked device, then wipes
// the stored session and the paired markers.
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
    pairingCode: runtime.pairingCode,
    error: runtime.lastError,
    health,
  };
}

function requireConnected() {
  if (!runtime.sock || !runtime.rawSock || runtime.status !== "connected") {
    throw new Error("WhatsApp isn't connected right now.");
  }
}

// The only send path. Goes through the anti-ban wrapper, which may delay
// the send (human-like spacing) or reject it outright while the health
// monitor has the number paused -- callers treat a throw as "leave the row
// queued and retry next pass".
async function sendText(jid, text) {
  requireConnected();
  await runtime.sock.sendMessage(jid, { text });
}

async function listCommunities() {
  requireConnected();
  const all = await runtime.rawSock.communityFetchAllParticipating();
  return Object.values(all || {}).map((c) => ({ id: c.id, name: c.subject || "(unnamed community)" }));
}

async function listCommunityGroups(communityJid) {
  requireConnected();
  const result = await runtime.rawSock.communityFetchLinkedGroups(communityJid);
  return (result?.linkedGroups || [])
    .filter((g) => g.id)
    .map((g) => ({ id: g.id, name: g.subject || "(unnamed group)" }));
}

// Called from SIGTERM: stop the socket and release the lock promptly so
// the incoming instance can take over instead of waiting out its retry.
async function shutdown() {
  await disconnect();
}

// Real network lookup for the current WhatsApp Web version, wired only in
// production -- a stale bundled version is a common cause of failed
// connections.
deps.fetchVersion = (baileys) => baileys.fetchLatestBaileysVersion();

module.exports = {
  syncWithSettings,
  startPairing,
  unlink,
  getStatus,
  sendText,
  listCommunities,
  listCommunityGroups,
  shutdown,
  // exported for tests only
  _deps: deps,
  _runtime: runtime,
  _handleConnectionUpdate: handleConnectionUpdate,
  _digitsFromJid: digitsFromJid,
};
