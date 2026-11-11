import React, { useEffect, useRef, useState } from "react";
import {
  fetchWhatsAppSettings,
  updateWhatsAppSettings,
  startWhatsAppPairing,
  fetchWhatsAppPairStatus,
  fetchWhatsAppCommunities,
  fetchWhatsAppGroups,
  unlinkWhatsApp,
} from "../api/client.js";

// Posts as a dedicated WhatsApp number linked to this app as a "linked
// device" (the same mechanism as WhatsApp Web) -- see
// backend/src/utils/whatsappClient.js. It's an UNOFFICIAL connection:
// WhatsApp can ban numbers used this way, so the page insists on a
// dedicated number and the Admin Guide spells out the risks.
//
// There is no token to paste. Linking works by pairing: a QR code scanned
// from WhatsApp (Linked Devices > Link a Device). The linked session is
// stored encrypted on the server and never sent back here -- the page only
// ever sees a status. The community and each group are picked from live
// lists, never hand-typed.
//
// One WhatsApp community holds several groups, so the three notification
// types each get their own group, mirroring GroupMe's three Topics. Same
// idea as GroupMe's main-group fallback: a type with no group of its own
// picked posts to the community's built-in Announcements group instead
// (detected automatically, never hand-picked -- see the Community
// section below). Only with neither set is it not sent over WhatsApp.
const GROUP_TYPES = [
  {
    number: 4,
    key: "prayer",
    title: "Prayer Requests Group",
    idField: "prayerGroupId",
    nameField: "prayerGroupName",
  },
  {
    number: 5,
    key: "oneTimeNeed",
    title: "One-Time Needs Group",
    idField: "oneTimeNeedGroupId",
    nameField: "oneTimeNeedGroupName",
  },
  {
    number: 6,
    key: "newsletter",
    title: "Newsletters Group",
    idField: "newsletterGroupId",
    nameField: "newsletterGroupName",
  },
];

const STATUS_TEXT = {
  connected: "Connected",
  connecting: "Connecting…",
  pairing: "Waiting for you to link the number…",
  disconnected: "Not connected",
  locked_elsewhere:
    "Another copy of the app is holding the connection (normal for a minute or two during an update).",
  logged_out: "The number was unlinked in WhatsApp. Link it again below.",
};

function GroupSection({ type, settings, communityId, groups, saving, onSave }) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const currentGroupName = settings[type.nameField];

  useEffect(() => {
    if (groups) setSelectedGroupId(settings[type.idField] || groups[0]?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  return (
    <div className="admin-section">
      <h3>
        {type.number}. {type.title}
      </h3>
      {currentGroupName ? (
        <p style={{ color: "#555" }}>Currently: {currentGroupName}</p>
      ) : (
        <p style={{ color: "#555" }}>
          No group selected yet — until one is, these aren't sent over WhatsApp.
        </p>
      )}
      {groups && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const picked = groups.find((g) => g.id === selectedGroupId);
              if (picked) onSave(type, picked);
            }}
            disabled={saving || !selectedGroupId}
          >
            Use This Group
          </button>
        </div>
      )}
      {!groups && !communityId && (
        <p style={{ color: "#888", fontSize: "0.9rem" }}>Pick a community first.</p>
      )}
    </div>
  );
}

export default function AdminSettingsWhatsApp() {
  const [settings, setSettings] = useState({
    paired: false,
    phoneNumber: null,
    communityId: null,
    communityName: null,
    announcementGroupId: null,
    announcementGroupName: null,
    prayerGroupId: null,
    prayerGroupName: null,
    oneTimeNeedGroupId: null,
    oneTimeNeedGroupName: null,
    newsletterGroupId: null,
    newsletterGroupName: null,
    connection: { status: "disconnected", health: null, error: null },
  });
  const [pairing, setPairing] = useState(false);
  const [pairStatus, setPairStatus] = useState(null);

  const [communities, setCommunities] = useState(null);
  const [groups, setGroups] = useState(null);
  const [selectedCommunityId, setSelectedCommunityId] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchWhatsAppSettings()
      .then(setSettings)
      .catch((err) => setError(err.response?.data?.error || "Couldn't load WhatsApp settings."))
      .finally(() => setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, []);

  // While a pairing is in progress, poll the server for the code/QR and
  // for the moment WhatsApp confirms the link.
  useEffect(() => {
    if (!pairing) return undefined;
    const timer = setInterval(async () => {
      try {
        const status = await fetchWhatsAppPairStatus();
        if (!mounted.current) return;
        setPairStatus(status);
        if (status.status === "connected") {
          setPairing(false);
          setSettings(await fetchWhatsAppSettings());
          setSuccess("Number linked.");
        } else if (status.status === "disconnected" || status.status === "logged_out") {
          setPairing(false);
          setError(status.error || "Pairing didn't complete. Start again.");
        }
      } catch (err) {
        if (mounted.current) setError(err.response?.data?.error || "Couldn't check the pairing status.");
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pairing]);

  async function handleStartPairing() {
    setBusy(true);
    setSuccess("");
    setError("");
    setPairStatus(null);
    try {
      await startWhatsAppPairing();
      setPairing(true);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't start pairing.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshStatus() {
    setError("");
    try {
      setSettings(await fetchWhatsAppSettings());
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't refresh the status.");
    }
  }

  async function handleUnlink() {
    if (
      !window.confirm(
        "Unlink this WhatsApp number? Notifications stop immediately and your community and group choices are cleared."
      )
    ) {
      return;
    }
    setBusy(true);
    setSuccess("");
    setError("");
    try {
      setSettings(await unlinkWhatsApp());
      setCommunities(null);
      setGroups(null);
      setPairStatus(null);
      setSuccess("Number unlinked.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't unlink the number.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadCommunities() {
    setLoadingCommunities(true);
    setSuccess("");
    setError("");
    try {
      const list = await fetchWhatsAppCommunities();
      setCommunities(list);
      setSelectedCommunityId(settings.communityId || list[0]?.id || "");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't load your WhatsApp communities.");
    } finally {
      setLoadingCommunities(false);
    }
  }

  async function handleSaveCommunity() {
    const picked = communities?.find((c) => c.id === selectedCommunityId);
    if (!picked) return;
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateWhatsAppSettings({ communityId: picked.id, communityName: picked.name });
      setSettings(updated);
      setGroups(null);
      setSuccess("Community saved.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the community.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadGroups() {
    if (!settings.communityId) return;
    setLoadingGroups(true);
    setSuccess("");
    setError("");
    try {
      setGroups(await fetchWhatsAppGroups(settings.communityId));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't load that community's groups.");
    } finally {
      setLoadingGroups(false);
    }
  }

  async function handleSaveGroup(type, picked) {
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const updated = await updateWhatsAppSettings({
        [type.idField]: picked.id,
        [type.nameField]: picked.name,
      });
      setSettings(updated);
      setSuccess(`${type.title} saved.`);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save the group.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="admin-shell">Loading…</p>;

  const connection = settings.connection || {};
  const connected = connection.status === "connected";
  const riskElevated = connection.health && connection.health.risk && connection.health.risk !== "low";

  return (
    <div className="admin-shell">
      <h2>WhatsApp</h2>
      <p style={{ color: "#555" }}>
        Posts new prayer requests, one-time needs, and newsletters to your WhatsApp community groups, on the
        same daily schedule as GroupMe (set under <a href="/admin/settings/notifications">Notifications</a>).
      </p>
      <div className="field-warning">
        This links a phone number to the app the same way WhatsApp Web does. It is not an official WhatsApp
        integration, and WhatsApp can ban numbers used this way. Use a <strong>dedicated number</strong> (a
        prepaid SIM or a second line) — never anyone's personal WhatsApp. See the Admin Guide for details.
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && <p style={{ color: "#2a5d3c" }}>{success}</p>}

      <div className="admin-section">
        <h3>1. Link the number</h3>
        {settings.paired ? (
          <>
            <p style={{ color: "#555" }}>
              Linked: <strong>+{settings.phoneNumber || "unknown number"}</strong> —{" "}
              {STATUS_TEXT[connection.status] || connection.status}
            </p>
            {riskElevated && (
              <p className="form-error" role="alert">
                WhatsApp is flagging this number as higher risk ({connection.health.risk}).{" "}
                {connection.health.recommendation} Sending may be slowed or paused until it settles.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn secondary" onClick={handleRefreshStatus}>
                Refresh Status
              </button>
              <button type="button" className="btn secondary" onClick={handleUnlink} disabled={busy}>
                Unlink Number
              </button>
            </div>
          </>
        ) : (
          <>
            {connection.status === "logged_out" && <p className="form-error">{STATUS_TEXT.logged_out}</p>}
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              On the dedicated phone, open WhatsApp → Settings → Linked Devices → Link a Device, then scan
              the QR code below.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={handleStartPairing} disabled={busy || pairing}>
                Show QR Code
              </button>
            </div>
            {pairing && !pairStatus?.qrDataUrl && (
              <p style={{ color: "#555" }}>Starting… this can take a few seconds.</p>
            )}
            {pairStatus?.qrDataUrl && (
              <div style={{ marginTop: "1rem" }}>
                <p style={{ margin: 0, color: "#555" }}>
                  On that phone: WhatsApp → Settings → Linked Devices → Link a Device, then scan:
                </p>
                <img src={pairStatus.qrDataUrl} alt="WhatsApp pairing QR code" width="400" height="400" />
              </div>
            )}
            {pairStatus?.error && <p className="form-error">{pairStatus.error}</p>}
          </>
        )}
      </div>

      <div className="admin-section">
        <h3>2. Community</h3>
        {settings.communityName ? (
          <>
            <p style={{ color: "#555" }}>Currently: {settings.communityName}</p>
            <p style={{ color: "#555", fontSize: "0.9rem" }}>
              {settings.announcementGroupName ? (
                <>
                  Announcements group (detected automatically): <strong>{settings.announcementGroupName}</strong>{" "}
                  — used for any notification type below with no group of its own picked.
                </>
              ) : (
                "No Announcements group was detected for this community -- a notification type with no group of its own picked below won't be sent."
              )}
            </p>
          </>
        ) : (
          <p style={{ color: "#555" }}>No community selected yet.</p>
        )}
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          The linked number must already be a member of the community and of each group you map below (and an
          admin of any group where only admins can post).
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary"
            onClick={handleLoadCommunities}
            disabled={!connected || loadingCommunities}
          >
            {loadingCommunities ? "Loading..." : "Load My Communities"}
          </button>
          {communities && (
            <>
              <select value={selectedCommunityId} onChange={(e) => setSelectedCommunityId(e.target.value)}>
                {communities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={handleSaveCommunity}
                disabled={saving || !selectedCommunityId}
              >
                Use This Community
              </button>
            </>
          )}
        </div>
        {communities && communities.length === 0 && (
          <p style={{ color: "#888", fontSize: "0.9rem" }}>
            This number isn't in any community yet — add it in WhatsApp, then load again.
          </p>
        )}
        {!connected && settings.paired && (
          <p style={{ color: "#888", fontSize: "0.9rem" }}>Available once the number is connected.</p>
        )}
      </div>

      <div className="admin-section">
        <h3>Groups</h3>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          One list of groups for the community above, shared by the three pickers below — load it once, then
          pick a group for each notification type you want.
        </p>
        <button
          type="button"
          className="btn secondary"
          onClick={handleLoadGroups}
          disabled={!connected || !settings.communityId || loadingGroups}
        >
          {loadingGroups ? "Loading..." : "Load Groups"}
        </button>
      </div>

      {GROUP_TYPES.map((type) => (
        <GroupSection
          key={type.key}
          type={type}
          settings={settings}
          communityId={settings.communityId}
          groups={groups}
          saving={saving}
          onSave={handleSaveGroup}
        />
      ))}
    </div>
  );
}
