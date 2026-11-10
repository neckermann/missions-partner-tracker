// A Baileys auth state backed by the WhatsAppAuthEntry table instead of
// files -- Baileys' own useMultiFileAuthState is documented as not for
// production, and on Render the web service's disk is wiped on every
// deploy, which would force a re-pair each time. One row per key ("creds"
// plus "<category>-<id>" per Signal key), and every value is an
// encryptField() ciphertext of the BufferJSON-serialized JSON, so the
// table never holds session material in plaintext (the same AES-256-GCM,
// FIELD_ENCRYPTION_KEY protection as the GroupMe access token). Losing
// that key means re-pairing, exactly like losing the GroupMe token.
//
// Nothing here is ever returned from an API route -- see
// routes/settings.js, which only ever reports a status derived from the
// live socket, never these rows.
//
// `baileys` is an ES module and this backend is CommonJS, so the pieces
// that come from it (BufferJSON, initAuthCreds, proto) are passed in by
// whatsappClient.js after its dynamic import() rather than required here;
// that also keeps this file unit-testable against a fake in-memory table.
const defaultPrisma = require("../prismaClient");
const { encryptField, decryptField } = require("./crypto");

const CREDS_KEY = "creds";

function makeKey(type, id) {
  return `${type}-${id}`;
}

async function useDbAuthState({ BufferJSON, initAuthCreds, proto }, table = defaultPrisma.whatsAppAuthEntry) {
  const serialize = (value) => encryptField(JSON.stringify(value, BufferJSON.replacer));
  const deserialize = (stored) => JSON.parse(decryptField(stored), BufferJSON.reviver);

  async function readOne(key) {
    const row = await table.findUnique({ where: { key } });
    if (!row) return null;
    try {
      return deserialize(row.value);
    } catch {
      // An undecryptable row (FIELD_ENCRYPTION_KEY rotated since it was
      // written) is treated as absent: for "creds" that means a fresh
      // unpaired state (the admin re-pairs); for a Signal key, Baileys
      // simply renegotiates that session.
      console.error(`WhatsApp auth entry "${key.split("-")[0]}" couldn't be decrypted; treating as missing.`);
      return null;
    }
  }

  const creds = (await readOne(CREDS_KEY)) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const keys = ids.map((id) => makeKey(type, id));
          const rows = await table.findMany({ where: { key: { in: keys } } });
          const byKey = new Map(rows.map((row) => [row.key, row.value]));
          const data = {};
          for (const id of ids) {
            const stored = byKey.get(makeKey(type, id));
            if (!stored) continue;
            let value;
            try {
              value = deserialize(stored);
            } catch {
              continue;
            }
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.create(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const upserts = [];
          const deletes = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = makeKey(type, id);
              if (value) {
                const stored = serialize(value);
                upserts.push(
                  table.upsert({
                    where: { key },
                    create: { key, value: stored },
                    update: { value: stored },
                  })
                );
              } else {
                deletes.push(key);
              }
            }
          }
          await Promise.all(upserts);
          if (deletes.length > 0) await table.deleteMany({ where: { key: { in: deletes } } });
        },
      },
    },
    saveCreds: async () => {
      const stored = serialize(creds);
      await table.upsert({
        where: { key: CREDS_KEY },
        create: { key: CREDS_KEY, value: stored },
        update: { value: stored },
      });
    },
  };
}

// Wipes the whole session -- used on unlink / a server-side logout, so a
// stale half-session never lingers to confuse the next pairing.
async function clearAuthState(table = defaultPrisma.whatsAppAuthEntry) {
  await table.deleteMany({});
}

module.exports = { useDbAuthState, clearAuthState };
