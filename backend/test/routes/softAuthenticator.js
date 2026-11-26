// A software WebAuthn authenticator for tests: builds the same registration and assertion
// messages a browser would hand the server, with a real ES256 key, so the route tests exercise
// the real verification instead of mocking it.
const crypto = require("crypto");

// Just enough CBOR for an attestation object and a COSE key.
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  };
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") {
    const b = Buffer.from(v);
    return Buffer.concat([head(3, b.length), b]);
  }
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, val]) => [cbor(k), cbor(val)])]);
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const b64u = (b) => Buffer.from(b).toString("base64url");

function createAuthenticator({ rpID, origin }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = crypto.randomBytes(32);
  let counter = 0;
  const rpIdHash = sha256(Buffer.from(rpID));
  const clientData = (type, challenge, o = origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));

  return {
    id: b64u(credentialId),
    // Answers navigator.credentials.create(). `origin` overrides what the "browser" reports.
    register(challenge, { origin: o } = {}) {
      const cose = cbor(
        new Map([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x, "base64url")],
          [-3, Buffer.from(jwk.y, "base64url")],
        ])
      );
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credentialId.length);
      const counterBuf = Buffer.alloc(4);
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45]), // user present, user verified, attested credential data
        counterBuf,
        Buffer.alloc(16),
        idLen,
        credentialId,
        cose,
      ]);
      const attestationObject = cbor({ fmt: "none", attStmt: {}, authData });
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64u(clientData("webauthn.create", challenge, o)),
          attestationObject: b64u(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    // Answers navigator.credentials.get(). `counterValue` forces the signature counter.
    assert(challenge, { origin: o, counterValue } = {}) {
      counter = counterValue ?? counter + 1;
      const counterBuf = Buffer.alloc(4);
      counterBuf.writeUInt32BE(counter);
      const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), counterBuf]);
      const cd = clientData("webauthn.get", challenge, o);
      const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(cd)]), privateKey);
      return {
        id: b64u(credentialId),
        rawId: b64u(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64u(cd),
          authenticatorData: b64u(authData),
          signature: b64u(signature),
        },
        clientExtensionResults: {},
      };
    },
  };
}

module.exports = { createAuthenticator };
