import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  fetchPartner,
  updatePartner,
  fetchPrayerRequests,
  fetchPartnerFiles,
  fetchSupportEntries,
  fetchSupportNeeds,
  fetchTrips,
  createPrayerRequest,
  updatePrayerRequest,
  createSupportNeed,
  updateSupportNeed,
  createSupportEntry,
  uploadPartnerFile,
  updatePartnerFile,
  fetchAdults,
  createAdult,
  updateAdult,
  deleteAdult,
  fetchChildren,
  createChild,
  updateChild,
  deleteChild,
  fetchFurloughs,
  createFurlough,
  updateFurlough,
  deleteFurlough,
  fetchChurchVisits,
  createChurchVisit,
  updateChurchVisit,
  deleteChurchVisit,
  fetchPartnerLinks,
  createPartnerLink,
  updatePartnerLink,
  deletePartnerLink,
  fetchPartnerLanguages,
  createPartnerLanguage,
  updatePartnerLanguage,
  deletePartnerLanguage,
  fetchTripTypes,
  createTripType,
  updateTripType,
  deleteTripType,
} from "../api/client.js";
import CountryStats from "../components/CountryStats.jsx";
import TripLeaderPartnerView from "../components/admin/TripLeaderPartnerView.jsx";
import StatusPill from "../components/admin/StatusPill.jsx";
import Field from "../components/admin/Field.jsx";
import PhotoHistorySection from "../components/admin/PhotoHistorySection.jsx";
import PartnerSummaryCard from "../components/admin/PartnerSummaryCard.jsx";
import RecordList from "../components/admin/RecordList.jsx";
import Breadcrumb from "../components/shared/Breadcrumb.jsx";
import EditableSection from "../components/admin/EditableSection.jsx";
import AddressFields, { roundGps } from "../components/admin/AddressFields.jsx";
import PresetOrCustomSelect from "../components/admin/PresetOrCustomSelect.jsx";
import { TRIP_TYPE_PRESETS } from "../components/admin/TripFormFields.jsx";
import QuickActionModal from "../components/shared/QuickActionModal.jsx";
import Modal from "../components/Modal.jsx";
import PrayerRequestFormFields from "../components/admin/PrayerRequestFormFields.jsx";
import SupportNeedFormFields from "../components/admin/SupportNeedFormFields.jsx";
import SupportEntryFormFields from "../components/admin/SupportEntryFormFields.jsx";
import PartnerFileFormFields from "../components/admin/PartnerFileFormFields.jsx";
import { FILE_KINDS, fileKindLabel } from "../utils/fileKinds.js";
import { LINK_TYPES, linkTypeLabel } from "../utils/linkTypes.js";
import { PROFICIENCY_LEVELS, proficiencyLabel } from "../utils/proficiencyLevels.js";
import { LANGUAGE_NAMES } from "../utils/languageNames.js";
import { supportNeedStatus } from "../utils/supportNeedStatus.js";
import { truncate } from "../utils/truncate.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { getFipsCode } from "../utils/countryFipsCodes.js";
import {
  formatDateLong,
  formatDate,
  formatCurrency,
  toDateInputValue,
  todayInputValue,
} from "../utils/format.js";
import { addressByType } from "../utils/addresses.js";
import { useRecordRecentlyViewed } from "../hooks/useRecentlyViewed.js";
import useConfirmDialog from "../hooks/useConfirmDialog.jsx";
import useChurchSettings from "../hooks/useChurchSettings.js";
import useUrgentApprovalGate from "../hooks/useUrgentApprovalGate.jsx";
import usePartnerRecordCrud from "../hooks/usePartnerRecordCrud.jsx";
import useLoadMore from "../hooks/useLoadMore.js";
import useCurrentUser from "../hooks/useCurrentUser.js";

// A cleared <input type="date"> is "", which `z.coerce.date()` turns into an
// Invalid Date and rejects -- "no date" has to travel as null.
const dateOrNull = (value) => value || null;

const CONTACT_METHOD_PRESETS = ["Email", "Phone", "WhatsApp", "Signal"];

const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvinceRegion: "",
  postalCode: "",
  country: "",
};

// An address the user never filled in shouldn't be persisted as a row of
// empty strings -- the API treats a present `physical`/`mailing` key as
// "this address exists", so an untouched one is sent as undefined instead.
function hasAnyAddressValue(address) {
  return (
    Object.keys(emptyAddress).some((key) => Boolean(address[key] && String(address[key]).trim())) ||
    Boolean(address.receiveMail) ||
    Boolean(address.receivePackages) ||
    address.gpsLat != null ||
    address.gpsLng != null
  );
}

// GPS comes back from a number input as a string; the API wants a number
// or null.
function cleanAddress(address) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const cleaned = { ...address, gpsLat: num(address.gpsLat), gpsLng: num(address.gpsLng) };
  return hasAnyAddressValue(cleaned) ? cleaned : undefined;
}

export function AddressSummary({ address }) {
  const a = address || {};
  const lines = [a.addressLine1, a.addressLine2].filter(Boolean);
  const cityLine = [a.city, a.stateProvinceRegion, a.postalCode].filter(Boolean).join(", ");
  if (!lines.length && !cityLine && !a.country)
    return <p style={{ color: "#888" }}>No mailing address on file.</p>;
  return (
    <div>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      {cityLine && <div>{cityLine}</div>}
      {a.country && <div>{a.country}</div>}
      {(a.receiveMail || a.receivePackages) && (
        <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "#666" }}>
          {[a.receiveMail && "Receives mail here", a.receivePackages && "Receives packages here"]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {a.gpsLat != null && a.gpsLng != null && (
        <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "#666" }}>
          GPS: {roundGps(a.gpsLat)}, {roundGps(a.gpsLng)}
        </div>
      )}
    </div>
  );
}

// The partner page *is* the record: every section saves only its own fields
// through the partial PUT, rather than routing everything through one
// whole-record form. See EditableSection for the reasoning.
export default function AdminPartnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [collections, setCollections] = useState({
    prayerRequests: [],
    files: [],
    supportEntries: [],
    needRequests: [],
    trips: [],
    adults: [],
    children: [],
    furloughs: [],
    churchVisits: [],
    links: [],
    languages: [],
    tripTypes: [],
  });
  const { churchName, enabledFeatures } = useSettings();
  const { confirm: confirmDialog, confirmElement } = useConfirmDialog();
  const { settings: churchSettings } = useChurchSettings();
  const confirmBeforeCreate = useUrgentApprovalGate({ confirmDialog, enabledFeatures });
  const adultCrud = usePartnerRecordCrud({
    createFn: createAdult,
    updateFn: updateAdult,
    deleteFn: deleteAdult,
    reload,
    confirmDialog,
  });
  const childCrud = usePartnerRecordCrud({
    createFn: createChild,
    updateFn: updateChild,
    deleteFn: deleteChild,
    reload,
    confirmDialog,
  });
  const furloughCrud = usePartnerRecordCrud({
    createFn: createFurlough,
    updateFn: updateFurlough,
    deleteFn: deleteFurlough,
    reload,
    confirmDialog,
  });
  const churchVisitCrud = usePartnerRecordCrud({
    createFn: createChurchVisit,
    updateFn: updateChurchVisit,
    deleteFn: deleteChurchVisit,
    reload,
    confirmDialog,
  });
  const linkCrud = usePartnerRecordCrud({
    createFn: createPartnerLink,
    updateFn: updatePartnerLink,
    deleteFn: deletePartnerLink,
    reload,
    confirmDialog,
  });
  const languageCrud = usePartnerRecordCrud({
    createFn: createPartnerLanguage,
    updateFn: updatePartnerLanguage,
    deleteFn: deletePartnerLanguage,
    reload,
    confirmDialog,
  });
  const tripTypeCrud = usePartnerRecordCrud({
    createFn: createTripType,
    updateFn: updateTripType,
    deleteFn: deleteTripType,
    reload,
    confirmDialog,
  });
  const [activeModal, setActiveModal] = useState(null);
  const [prayerForm, setPrayerForm] = useState(null);
  const [prayerAnswerForm, setPrayerAnswerForm] = useState(null);
  const [needForm, setNeedForm] = useState(null);
  const [needDecisionForm, setNeedDecisionForm] = useState(null);
  const [supportEntryForm, setSupportEntryForm] = useState(null);
  const [fileForm, setFileForm] = useState(null);
  const [fileBlob, setFileBlob] = useState(null);
  // Click-to-view/edit popups for an *existing* Prayer Request/One-Time
  // Need/Newsletter & Doc item (see the summary cards below) -- `{ id,
  // form }`, distinct from the above add-forms. Each one's `form` key
  // only holds what that resource's own FormFields component edits.
  const [prayerDetail, setPrayerDetail] = useState(null);
  const [needDetail, setNeedDetail] = useState(null);
  const [fileDetail, setFileDetail] = useState(null);
  // Which specific record "Mark Answered"/"Record Decision" targets --
  // previously these actions were hardcoded to prayerRequests[0]/
  // needRequests[0] (the single most recent item), which silently acted on
  // the wrong record whenever more than one item was still undecided. Set
  // from the item that was actually clicked (either the summary card's own
  // list, or the view popup's own "Record Decision"/"Mark Answered"
  // button), same as AdminOneTimeNeeds.jsx/AdminPrayerRequests.jsx already
  // do it correctly.
  const [answeringPrayer, setAnsweringPrayer] = useState(null);
  const [decidingNeed, setDecidingNeed] = useState(null);

  // React Router keeps this same component instance mounted across a
  // /partners/:id param change -- it doesn't remount. reload() is passed
  // as onSaved/onChange to nearly every section on this page, so a save on
  // partner A that's still in flight when the admin navigates to partner B
  // would otherwise land A's data on B's screen once it resolves. idRef is
  // kept current every render (not just via reload's own closure) so a
  // reload() call can tell, when it finally resolves, whether the id it
  // was fetching for is still the one being viewed.
  const idRef = useRef(id);
  idRef.current = id;

  function reload() {
    const requestId = id;
    return Promise.all([
      fetchPartner(id).then((data) => {
        if (idRef.current === requestId) setP(data);
      }),
      Promise.all([
        fetchPrayerRequests({ partnerId: id }),
        fetchPartnerFiles({ partnerId: id }),
        fetchSupportEntries({ partnerId: id }),
        fetchSupportNeeds({ partnerId: id }),
        enabledFeatures.trips ? fetchTrips({ partnerId: id }) : Promise.resolve([]),
        fetchAdults({ partnerId: id }),
        fetchChildren({ partnerId: id }),
        fetchFurloughs({ partnerId: id }),
        fetchChurchVisits({ partnerId: id }),
        fetchPartnerLinks({ partnerId: id }),
        fetchPartnerLanguages({ partnerId: id }),
        fetchTripTypes({ partnerId: id }),
      ]).then(
        ([
          prayerRequests,
          files,
          supportEntries,
          needRequests,
          trips,
          adults,
          children,
          furloughs,
          churchVisits,
          links,
          languages,
          tripTypes,
        ]) => {
          if (idRef.current === requestId) {
            setCollections({
              prayerRequests,
              files,
              supportEntries,
              needRequests,
              trips,
              adults,
              children,
              furloughs,
              churchVisits,
              links,
              languages,
              tripTypes,
            });
          }
        }
      ),
    ]);
  }

  const { canWrite, isAdmin, isTripLeader, loading: userLoading } = useCurrentUser();

  useEffect(() => {
    // A Trip Leader never renders through this page's own big fetch path
    // at all (see the isTripLeader render-guard below) -- they get the
    // separate, deliberately minimal TripLeaderPartnerView instead, with
    // its own independent fetch of just what it shows. Skipping reload()
    // here once that's confirmed avoids a wasted (and, for
    // supportEntries/supportNeeds specifically, now-403ing) fetch -- but
    // this check is NOT gated on userLoading first: isTripLeader is false
    // for every role during that brief resolving window regardless of the
    // real role, so gating on it too would delay every admin/editor/
    // viewer's initial load behind the role check finishing first, for a
    // race that, for an actual Trip Leader, is harmless anyway (the
    // rejected promise this might still kick off a moment before
    // isTripLeader flips true is caught below exactly like any other
    // transient fetch failure, and never reaches a render that would use
    // it -- see the render-guard's own comment).
    if (isTripLeader) return;
    reload().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isTripLeader]);

  // Called unconditionally, before the loading guard below, so the number
  // of hooks this component calls doesn't change between the "still
  // loading" render (p is null) and every render after -- see Rules of
  // Hooks.
  useRecordRecentlyViewed(p && { to: `/admin/partners/${p.id}`, label: p.displayName, kind: "Partner" });

  // Shows a couple of entries right here instead of only linking out to
  // the consolidated Monthly Support page, which may not stick around --
  // see PartnerSummaryCard's own hasMore/remaining/onShowMore props.
  const supportEntriesLoadMore = useLoadMore(collections.supportEntries, { initialCount: 2, step: 100 });
  const churchVisitsLoadMore = useLoadMore(collections.churchVisits, { initialCount: 2, step: 100 });
  const furloughsLoadMore = useLoadMore(collections.furloughs, { initialCount: 2, step: 100 });
  const needRequestsLoadMore = useLoadMore(collections.needRequests, { initialCount: 3, step: 100 });
  const prayerRequestsLoadMore = useLoadMore(collections.prayerRequests, { initialCount: 3, step: 100 });
  const filesLoadMore = useLoadMore(collections.files, { initialCount: 3, step: 100 });
  const tripsLoadMore = useLoadMore(collections.trips, { initialCount: 3, step: 100 });

  if (userLoading) return <p style={{ padding: "2rem" }}>Loading...</p>;
  // A Trip Leader (role: "tripLeader") gets a separate, deliberately
  // minimal view of their one linked Partner -- not this page's full
  // admin/editor/viewer layout with sections hidden/shown by role. See
  // TripLeaderPartnerView's own comment for what it does and doesn't show
  // and why.
  if (isTripLeader) return <TripLeaderPartnerView partnerId={id} />;

  if (!p) return <p style={{ padding: "2rem" }}>Loading...</p>;

  const isOrg = p.kind === "organization";
  const save = (patch) => updatePartner(id, patch);

  // Same precondition "Mark as urgent"/"Review and approve now" gate as
  // AdminPrayerRequests.jsx/AdminOneTimeNeeds.jsx -- these quick-add modals
  // reuse the exact same create flow (useUrgentApprovalGate), just with a
  // fixed partner instead of a picker.
  const hasEnabledChannel =
    enabledFeatures.groupme || enabledFeatures.whatsapp || enabledFeatures.outboundEmail;
  const usedLinkTypes = new Set(collections.links.map((l) => l.type));
  const allowRestrictedPartnerDispatch = churchSettings?.allowRestrictedPartnerDispatch !== false;
  const canApproveNow = !!p.isRestricted && hasEnabledChannel && allowRestrictedPartnerDispatch;
  // Gates whether clicking a Prayer Request/One-Time Need/Newsletter &
  // Doc summary-card item opens an editable form or a read-only view --
  // matches the roles these resources' own PUT routes already require
  // (requireRole("admin", "editor")), so a viewer never sees a Save
  // button for something the server would reject anyway. Also gates every
  // EditableSection/RecordList/PhotoHistorySection/PartnerSummaryCard
  // mutate action on this page -- `canDelete` (admin-only) is separate
  // since delete permission is admin-only for every one of this page's
  // child collections (adults/children/furloughs/church visits/languages/
  // links/trip types) and photos, confirmed against each resource's own
  // DELETE route.
  const canEdit = canWrite;
  const canDelete = isAdmin;

  // One-click shortcut for the common case (praying for a partner during
  // today's service and recording it right after) -- same today's-date
  // convenience as every "Mark ___" quick action on this page
  // (submitMarkAnswered etc.), just without its own confirmation modal
  // since there's nothing to fill in. Catching up on a date in the past
  // still goes through the EditableSection's own edit popup below, same
  // as every other date field on this page.
  async function markPrayedWithCongregationToday() {
    await save({ lastPrayedWithCongregationAt: todayInputValue() });
    await reload();
  }

  function closeModal() {
    setActiveModal(null);
  }

  function openAddPrayerRequest() {
    setPrayerForm({
      category: "strategic",
      requestText: "",
      dateReceived: todayInputValue(),
      isPublic: false,
      includeInBooklet: false,
      untracked: false,
      isUrgent: false,
      approveNow: false,
      notes: "",
      sourceFileId: null,
    });
    setActiveModal("add-prayer");
  }

  async function submitAddPrayerRequest() {
    const proceed = await confirmBeforeCreate({
      approveNow: prayerForm.approveNow,
      isUrgent: prayerForm.isUrgent,
      partnerId: p.id,
      text: prayerForm.requestText.trim(),
    });
    if (!proceed) return false;
    const isStrategic = prayerForm.category === "strategic";
    await createPrayerRequest({
      partnerId: p.id,
      category: prayerForm.category,
      requestText: prayerForm.requestText.trim(),
      dateReceived: prayerForm.dateReceived,
      isPublic: isStrategic ? prayerForm.isPublic : false,
      includeInBooklet: isStrategic && prayerForm.isPublic ? prayerForm.includeInBooklet : false,
      status: prayerForm.untracked ? "untracked" : "ongoing",
      isUrgent: prayerForm.isUrgent,
      approveNow: prayerForm.approveNow,
      notes: prayerForm.notes || null,
      sourceFileId: prayerForm.sourceFileId,
    });
    await reload();
  }

  function openMarkAnswered(request) {
    setAnsweringPrayer(request);
    setPrayerAnswerForm({ dateAnswered: todayInputValue(), answeredNote: "" });
    setActiveModal("answer-prayer");
  }

  async function submitMarkAnswered() {
    await updatePrayerRequest(answeringPrayer.id, {
      status: "answered",
      dateAnswered: prayerAnswerForm.dateAnswered,
      answeredNote: prayerAnswerForm.answeredNote || null,
    });
    await reload();
  }

  // Opens any prayer request from the summary card's list, not just the
  // most recent -- `setPrayerDetail`'s updater wraps whatever
  // PrayerRequestFormFields passes it (a plain object or a `(prev) =>
  // next` function, same contract every other form here uses) so it
  // still only ever touches this item's own `form` key.
  function openPrayerDetail(item) {
    setPrayerDetail({
      id: item.id,
      form: {
        category: item.category,
        requestText: item.requestText,
        dateReceived: toDateInputValue(item.dateReceived),
        isPublic: item.isPublic,
        includeInBooklet: item.includeInBooklet,
        notes: item.notes || "",
        sourceFileId: item.sourceFileId || null,
        status: item.status,
        dateAnswered: item.dateAnswered,
        answeredNote: item.answeredNote,
      },
    });
    setActiveModal("view-prayer");
  }

  function setPrayerDetailForm(updater) {
    setPrayerDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitPrayerDetail() {
    const isStrategic = prayerDetail.form.category === "strategic";
    await updatePrayerRequest(prayerDetail.id, {
      category: prayerDetail.form.category,
      requestText: prayerDetail.form.requestText.trim(),
      dateReceived: prayerDetail.form.dateReceived,
      isPublic: isStrategic ? prayerDetail.form.isPublic : false,
      includeInBooklet:
        isStrategic && prayerDetail.form.isPublic ? prayerDetail.form.includeInBooklet : false,
      notes: prayerDetail.form.notes || null,
      sourceFileId: prayerDetail.form.sourceFileId,
    });
    await reload();
  }

  function openAddNeed() {
    setNeedForm({
      description: "",
      requestedAmount: "",
      requestDate: "",
      notes: "",
      isUrgent: false,
      approveNow: false,
      sourceFileId: null,
    });
    setActiveModal("add-need");
  }

  async function submitAddNeed() {
    const proceed = await confirmBeforeCreate({
      approveNow: needForm.approveNow,
      isUrgent: needForm.isUrgent,
      partnerId: p.id,
      text: needForm.description.trim(),
    });
    if (!proceed) return false;
    await createSupportNeed({
      partnerId: p.id,
      description: needForm.description.trim(),
      requestedAmount: Number(needForm.requestedAmount),
      requestDate: needForm.requestDate,
      notes: needForm.notes || null,
      approveNow: needForm.approveNow,
      isUrgent: needForm.isUrgent,
      sourceFileId: needForm.sourceFileId,
    });
    await reload();
  }

  function openRecordDecision(need) {
    setDecidingNeed(need);
    setNeedDecisionForm({ approvedAmount: "", approvedDate: "", decisionNote: "" });
    setActiveModal("decide-need");
  }

  async function submitRecordDecision() {
    await updateSupportNeed(decidingNeed.id, {
      approvedAmount: Number(needDecisionForm.approvedAmount),
      approvedDate: needDecisionForm.approvedDate,
      decisionNote: needDecisionForm.decisionNote || null,
    });
    await reload();
  }

  function openNeedDetail(item) {
    setNeedDetail({
      id: item.id,
      form: {
        description: item.description,
        requestedAmount: String(item.requestedAmount),
        requestDate: toDateInputValue(item.requestDate),
        notes: item.notes || "",
        sourceFileId: item.sourceFileId || null,
        approvedAmount: item.approvedAmount,
        approvedDate: item.approvedDate,
        decisionNote: item.decisionNote,
      },
    });
    setActiveModal("view-need");
  }

  function setNeedDetailForm(updater) {
    setNeedDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitNeedDetail() {
    await updateSupportNeed(needDetail.id, {
      description: needDetail.form.description.trim(),
      requestedAmount: Number(needDetail.form.requestedAmount),
      requestDate: needDetail.form.requestDate,
      notes: needDetail.form.notes || null,
      sourceFileId: needDetail.form.sourceFileId,
    });
    await reload();
  }

  function openAddSupportEntry() {
    setSupportEntryForm({ amount: "", effectiveDate: todayInputValue(), notes: "" });
    setActiveModal("add-support");
  }

  async function submitAddSupportEntry() {
    await createSupportEntry({
      partnerId: p.id,
      amount: Number(supportEntryForm.amount),
      effectiveDate: supportEntryForm.effectiveDate,
      notes: supportEntryForm.notes || null,
    });
    await reload();
  }

  function openUploadFile() {
    setFileForm({
      kind: FILE_KINDS[0].value,
      customKind: "",
      title: "",
      receivedDate: todayInputValue(),
      notes: "",
    });
    setFileBlob(null);
    setActiveModal("add-file");
  }

  async function submitUploadFile() {
    if (!fileBlob) throw new Error("Choose a file to upload");
    if (fileForm.kind === "other" && !fileForm.customKind.trim()) {
      throw new Error("Enter a label for this file's kind");
    }
    const formData = new FormData();
    formData.append("file", fileBlob);
    formData.append("partnerId", p.id);
    formData.append("kind", fileForm.kind);
    if (fileForm.kind === "other") formData.append("customKind", fileForm.customKind);
    formData.append("title", fileForm.title);
    formData.append("receivedDate", fileForm.receivedDate);
    formData.append("notes", fileForm.notes);
    await uploadPartnerFile(formData);
    await reload();
  }

  function openFileDetail(file) {
    setFileDetail({
      id: file.id,
      form: {
        kind: file.kind,
        customKind: file.customKind || "",
        title: file.title || "",
        receivedDate: toDateInputValue(file.receivedDate),
        notes: file.notes || "",
      },
    });
    setActiveModal("view-file");
  }

  function setFileDetailForm(updater) {
    setFileDetail((d) => ({ ...d, form: typeof updater === "function" ? updater(d.form) : updater }));
  }

  async function submitFileDetail() {
    if (fileDetail.form.kind === "other" && !fileDetail.form.customKind.trim()) {
      throw new Error("Enter a label for this file's kind");
    }
    await updatePartnerFile(fileDetail.id, {
      kind: fileDetail.form.kind,
      customKind: fileDetail.form.kind === "other" ? fileDetail.form.customKind.trim() : null,
      title: fileDetail.form.title,
      receivedDate: fileDetail.form.receivedDate,
      notes: fileDetail.form.notes,
    });
    await reload();
  }

  const physical = addressByType(p.addresses, "physical") || {};
  const mailing = addressByType(p.addresses, "mailing") || {};

  // Addresses are replaced as a pair on the server, so a section editing one
  // of them has to send the other back untouched or it would be deleted.
  const saveAddress = (type) => (draft) => {
    const { address, fipsCountryCode, ...rest } = draft;
    return save({
      addresses: {
        physical: cleanAddress(type === "physical" ? address : physical),
        mailing: cleanAddress(type === "mailing" ? address : mailing),
      },
      ...(type === "physical" ? { fipsCountryCode: fipsCountryCode || null } : {}),
      ...rest,
    });
  };

  // The user's calendar date, not UTC's: comparing against the UTC date made
  // a furlough starting tomorrow read as already active for the last hours
  // of the day west of UTC.
  const today = todayInputValue();
  const activeFurlough = (p.furloughs || []).find((f) => {
    const start = String(f.startDate).slice(0, 10);
    const end = f.endDate ? String(f.endDate).slice(0, 10) : null;
    return start <= today && (!end || end >= today);
  });

  return (
    <div className="admin-shell">
      <Breadcrumb items={[{ label: "Partners", to: "/admin/partners" }, { label: p.displayName }]} />
      <div>
        <h2 style={{ marginBottom: "0.25rem" }}>{p.displayName}</h2>
        <p style={{ color: "#666", margin: 0 }}>
          {isOrg ? `${p.orgType || "Partner"} Organization` : "Missionary"}
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "1rem 0" }}>
        {!isOrg && (
          <StatusPill
            label={p.contactSafe ? "Safe to contact" : "Not safe to contact"}
            color={p.contactSafe ? "#2a5d3c" : "#a6540f"}
          />
        )}
        <StatusPill
          label={p.isPublic ? "Shown on public site" : "Not public"}
          color={p.isPublic ? "#2a5d3c" : "#6b6f76"}
        />
        {p.isRestricted && <StatusPill label="Restricted-access" color="#a6540f" />}
        {!isOrg && (
          <span title="Edit in the Sending Church box below to change this.">
            <StatusPill
              label={
                p.sentByOurChurch
                  ? `Sent by ${churchName || "our church"}`
                  : `Not sent by ${churchName || "our church"}`
              }
              color="#6b6f76"
            />
          </span>
        )}
        {activeFurlough && <StatusPill label="On Furlough" color="#a6540f" />}
        {p.archived && <StatusPill label={`Archived ${formatDateLong(p.archivedAt)}`} color="#a6540f" />}
      </div>

      <div className="partner-jump-rail">
        {[
          { label: "Overview", href: "#section-overview" },
          !isOrg && { label: "Family & Personal", href: "#section-family" },
          { label: "Location & Contact", href: "#section-location" },
          (enabledFeatures.monthlySupport || enabledFeatures.oneTimeNeeds) && {
            label: "Financial",
            href: "#section-financial",
          },
          { label: "Mission Trips", href: "#section-trips" },
          { label: "Communication", href: "#section-communication" },
        ]
          .filter(Boolean)
          .map((item) => (
            <a key={item.href} href={item.href} className="btn secondary small">
              {item.label}
            </a>
          ))}
      </div>

      <div className="admin-form" id="section-overview" style={{ scrollMarginTop: "1rem" }}>
        <EditableSection
          title="Status &amp; Visibility"
          canEdit={canEdit}
          onSaved={reload}
          onSave={save}
          value={{
            displayName: p.displayName,
            isPublic: p.isPublic,
            isRestricted: p.isRestricted,
            ...(!isOrg ? { contactSafe: p.contactSafe } : {}),
          }}
          view={(v) => (
            <>
              <Field label={isOrg ? "Organization Name" : "Display Name"} value={v.displayName} showEmpty />
              <div className="admin-checkbox-row" style={{ marginTop: "0.75rem" }}>
                <Field label="Shown on public site" value={v.isPublic ? "Yes" : "No"} />
                <Field label="Restricted-access location" value={v.isRestricted ? "Yes" : "No"} />
                {!isOrg && <Field label="Safe to Contact" value={v.contactSafe ? "Yes" : "No"} />}
              </div>
            </>
          )}
          edit={(d, set) => (
            <>
              <label title="The public display name shown on the directory, map, and booklet -- this is what's shown for them across the whole site.">
                {isOrg ? "Organization Name" : "Display Name"}
                <input value={d.displayName} onChange={(e) => set("displayName", e.target.value)} required />
              </label>
              <div className="admin-checkbox-row" style={{ marginTop: "0.75rem" }}>
                <label>
                  <input
                    type="checkbox"
                    checked={d.isPublic}
                    onChange={(e) => set("isPublic", e.target.checked)}
                  />
                  Show on public site
                </label>
                <label title="Masks the name to initials and coarsens the map pin to a country centroid on the public site.">
                  <input
                    type="checkbox"
                    checked={d.isRestricted}
                    onChange={(e) => set("isRestricted", e.target.checked)}
                  />
                  Restricted-access location
                </label>
                {!isOrg && (
                  <label>
                    <input
                      type="checkbox"
                      checked={d.contactSafe}
                      onChange={(e) => set("contactSafe", e.target.checked)}
                    />
                    Safe to contact
                  </label>
                )}
              </div>
            </>
          )}
        />

        <PhotoHistorySection
          partnerId={p.id}
          photos={p.photos}
          onChange={reload}
          canEdit={canEdit}
          canDelete={canDelete}
        />

        <EditableSection
          title="Ministry Overview"
          canEdit={canEdit}
          onSaved={reload}
          onSave={save}
          value={{
            overviewShort: p.overviewShort || "",
            overview: p.overview || "",
            focusArea: p.focusArea || "",
          }}
          view={(v) => (
            <>
              <Field label="Short Overview" value={v.overviewShort} showEmpty />
              <div style={{ marginTop: "0.75rem" }}>
                <Field label="Full Overview" value={v.overview} showEmpty />
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <Field label="Ministry Focus" value={v.focusArea} showEmpty />
              </div>
            </>
          )}
          edit={(d, set) => (
            <>
              <label>
                Short Overview (one or two lines, used on directory cards)
                <input value={d.overviewShort} onChange={(e) => set("overviewShort", e.target.value)} />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Full Overview
                <textarea rows={5} value={d.overview} onChange={(e) => set("overview", e.target.value)} />
              </label>
              <label style={{ marginTop: "0.75rem" }}>
                Ministry Focus
                <textarea rows={2} value={d.focusArea} onChange={(e) => set("focusArea", e.target.value)} />
              </label>
            </>
          )}
        />

        <div className="admin-section-group" id="section-family">
          <h2 className="admin-group-heading">Family &amp; Personal</h2>

          {!isOrg && (
            <EditableSection
              title="Wedding Anniversary"
              canEdit={canEdit}
              onSaved={reload}
              onSave={(d) => save({ anniversary: dateOrNull(d.anniversary) })}
              value={{ anniversary: toDateInputValue(p.anniversary) }}
              view={(v) => (
                <Field label="Wedding Anniversary" value={formatDateLong(v.anniversary)} showEmpty />
              )}
              edit={(d, set) => (
                <label style={{ maxWidth: "220px" }}>
                  Wedding Anniversary
                  <input
                    type="date"
                    value={d.anniversary}
                    onChange={(e) => set("anniversary", e.target.value)}
                  />
                </label>
              )}
            />
          )}

          {!isOrg && (
            <RecordList
              title="Adults"
              canEdit={canEdit}
              canDelete={canDelete}
              items={collections.adults}
              renderItem={(a) => (
                <>
                  <Field label="Name" value={[a.firstName, a.lastName].filter(Boolean).join(" ")} />
                  <Field label="Birthday" value={formatDateLong(a.birthday)} />
                  <Field label="Phone 1" value={a.phone1} />
                  <Field label="Phone 2" value={a.phone2} />
                  <Field label="Email" value={a.email} />
                </>
              )}
              onAdd={() =>
                adultCrud.openAdd({
                  firstName: "",
                  lastName: "",
                  phone1: "",
                  phone2: "",
                  email: "",
                  birthday: "",
                })
              }
              onEdit={(a) =>
                adultCrud.openEdit(a.id, {
                  firstName: a.firstName || "",
                  lastName: a.lastName || "",
                  phone1: a.phone1 || "",
                  phone2: a.phone2 || "",
                  email: a.email || "",
                  birthday: toDateInputValue(a.birthday),
                })
              }
              onDelete={(a) =>
                adultCrud.handleDelete(
                  a,
                  (item) => `Delete ${[item.firstName, item.lastName].filter(Boolean).join(" ")}?`
                )
              }
            />
          )}

          {!isOrg && (
            <RecordList
              title="Children"
              canEdit={canEdit}
              canDelete={canDelete}
              items={collections.children}
              renderItem={(c) => (
                <>
                  <Field label="Name" value={[c.firstName, c.lastName].filter(Boolean).join(" ")} />
                  <Field label="Birthday" value={formatDateLong(c.birthday)} />
                </>
              )}
              onAdd={() => childCrud.openAdd({ firstName: "", lastName: "", birthday: "" })}
              onEdit={(c) =>
                childCrud.openEdit(c.id, {
                  firstName: c.firstName || "",
                  lastName: c.lastName || "",
                  birthday: toDateInputValue(c.birthday),
                })
              }
              onDelete={(c) =>
                childCrud.handleDelete(
                  c,
                  (item) => `Delete ${[item.firstName, item.lastName].filter(Boolean).join(" ")}?`
                )
              }
            />
          )}

          {!isOrg && (
            <RecordList
              title="Languages Spoken"
              canEdit={canEdit}
              canDelete={canDelete}
              items={collections.languages}
              renderItem={(l) => (
                <>
                  <Field label="Language" value={l.language} />
                  <Field
                    label="Proficiency"
                    value={l.proficiency ? proficiencyLabel(l.proficiency) : null}
                    showEmpty
                  />
                </>
              )}
              onAdd={() => languageCrud.openAdd({ language: "", proficiency: "" })}
              onEdit={(l) =>
                languageCrud.openEdit(l.id, { language: l.language, proficiency: l.proficiency || "" })
              }
              onDelete={(l) => languageCrud.handleDelete(l, (item) => `Delete ${item.language}?`)}
            />
          )}

          {!isOrg && (
            <EditableSection
              title="Emergency Contact"
              canEdit={canEdit}
              onSaved={reload}
              onSave={(d) =>
                save({
                  emergencyContactName: d.name,
                  emergencyContactPhone: d.phone,
                  emergencyContactEmail: d.email,
                })
              }
              value={{
                name: p.emergencyContactName || "",
                phone: p.emergencyContactPhone || "",
                email: p.emergencyContactEmail || "",
              }}
              view={(v) => (
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                  <Field label="Name" value={v.name} showEmpty />
                  <Field label="Phone" value={v.phone} showEmpty />
                  <Field label="Email" value={v.email} showEmpty />
                </div>
              )}
              edit={(d, set) => (
                <div className="form-grid">
                  <label>
                    Name
                    <input value={d.name} onChange={(e) => set("name", e.target.value)} />
                  </label>
                  <label>
                    Phone
                    <input value={d.phone} onChange={(e) => set("phone", e.target.value)} />
                  </label>
                  <label>
                    Email
                    <input value={d.email} onChange={(e) => set("email", e.target.value)} />
                  </label>
                </div>
              )}
            />
          )}
        </div>

        <div className="admin-section-group" id="section-location">
          <h2 className="admin-group-heading">Location &amp; Contact</h2>

          <EditableSection
            title="Serving Location"
            canEdit={canEdit}
            onSaved={reload}
            onSave={saveAddress("physical")}
            value={{
              address: { ...emptyAddress, ...physical },
              fipsCountryCode: p.fipsCountryCode || "",
              fieldDisplayName: p.fieldDisplayName || "",
            }}
            view={(v) => (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
                  <Field label="Field / Region" value={v.fieldDisplayName} showEmpty />
                  {enabledFeatures.joshuaProject && (
                    <Field label="Country Code" value={p.fipsCountryCode} showEmpty />
                  )}
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  <AddressSummary address={physical} />
                </div>
              </>
            )}
            edit={(d, set) => (
              <>
                <div className="form-grid">
                  <label>
                    Field / Region Display Name
                    <input
                      value={d.fieldDisplayName}
                      onChange={(e) => set("fieldDisplayName", e.target.value)}
                    />
                    {/* This field is published even for a restricted partner --
                        see toPublicPartner in backend/src/utils/maskData.js. The
                        masking hides the name and coarsens the map pin to a
                        country centroid, so a sub-national region typed here
                        gives back most of what the masking just removed.
                        isRestricted itself now lives in Status & Visibility,
                        so this reads the partner record directly. */}
                    {p.isRestricted && (
                      <span className="field-warning">
                        Shown publicly, even though this partner is restricted. Their name is masked to
                        initials and the map pin is coarsened to the country — so keep this broad (&ldquo;East
                        Africa&rdquo;), not a region or city that narrows it back down.
                      </span>
                    )}
                  </label>
                  {enabledFeatures.joshuaProject && (
                    <label title="Looks up Joshua Project's country statistics for this field/region -- nothing else uses this field. Auto-fills from the country entered below, but Joshua Project uses the older FIPS codes, not ISO -- they disagree for some countries, so correct it here if the stats below look wrong.">
                      Country Code (FIPS/ISO)
                      <input
                        value={d.fipsCountryCode}
                        onChange={(e) => set("fipsCountryCode", e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <AddressFields
                  idPrefix="physical"
                  value={d.address}
                  onChange={(addr) => {
                    set("address", addr);
                    // Fill the FIPS code from a recognized country name, but
                    // never overwrite one that's already there -- FIPS and ISO
                    // disagree for many countries and the existing value may
                    // be a deliberate choice.
                    if (!d.fipsCountryCode && addr.country !== d.address.country) {
                      const fips = getFipsCode(addr.country);
                      if (fips) set("fipsCountryCode", fips);
                    }
                  }}
                  showGps
                />
              </>
            )}
          />

          {/* Its own plain (non-clickable) card, not nested inside Serving
              Location's EditableSection above -- it used to be, and the
              "Show Country Statistics" button's click bubbled up into that
              card's own onClick, silently opening the edit popup instead of
              expanding the stats. See CountryStats.jsx's own comment for why
              it now loads by default rather than behind that button. */}
          {enabledFeatures.joshuaProject && p.fipsCountryCode && (
            <div className="admin-section">
              <h3>Joshua Project Statistics</h3>
              <div style={{ marginTop: "1rem" }}>
                <CountryStats countryCode={p.fipsCountryCode} />
              </div>
            </div>
          )}

          <EditableSection
            title="Mailing &amp; Contact Address"
            canEdit={canEdit}
            onSaved={reload}
            onSave={saveAddress("mailing")}
            value={{
              address: { ...emptyAddress, receiveMail: false, receivePackages: false, ...mailing },
              orgType: p.orgType || "Local",
              preferredContactMethod: p.preferredContactMethod || "",
              contactFirstName: p.contactFirstName || "",
              contactLastName: p.contactLastName || "",
              contactPhone: p.contactPhone || "",
              contactEmail: p.contactEmail || "",
            }}
            view={(v) => (
              <>
                <Field label="Preferred Contact Method" value={v.preferredContactMethod} showEmpty />
                {isOrg && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", marginTop: "0.75rem" }}>
                    <Field
                      label="Contact Name"
                      value={[v.contactFirstName, v.contactLastName].filter(Boolean).join(" ")}
                      showEmpty
                    />
                    <Field label="Contact Phone" value={v.contactPhone} showEmpty />
                    <Field label="Contact Email" value={v.contactEmail} showEmpty />
                  </div>
                )}
                <div style={{ marginTop: "0.75rem" }}>
                  <AddressSummary address={mailing} />
                </div>
              </>
            )}
            edit={(d, set) => (
              <>
                <div className="form-grid">
                  {isOrg && (
                    <label>
                      Organization Type
                      <select value={d.orgType} onChange={(e) => set("orgType", e.target.value)}>
                        <option value="Local">Local</option>
                        <option value="National">National</option>
                      </select>
                    </label>
                  )}
                  <label>
                    Preferred Contact Method
                    <PresetOrCustomSelect
                      value={d.preferredContactMethod}
                      onChange={(v) => set("preferredContactMethod", v)}
                      presets={CONTACT_METHOD_PRESETS}
                      placeholder="e.g. Telegram"
                    />
                  </label>
                  {isOrg && (
                    <>
                      <label>
                        Contact First Name
                        <input
                          value={d.contactFirstName}
                          onChange={(e) => set("contactFirstName", e.target.value)}
                        />
                      </label>
                      <label>
                        Contact Last Name
                        <input
                          value={d.contactLastName}
                          onChange={(e) => set("contactLastName", e.target.value)}
                        />
                      </label>
                      <label>
                        Contact Phone
                        <input value={d.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
                      </label>
                      <label>
                        Contact Email
                        <input value={d.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
                      </label>
                    </>
                  )}
                </div>
                <div style={{ marginTop: "1rem" }}>
                  <AddressFields
                    idPrefix="mailing"
                    value={d.address}
                    onChange={(addr) => set("address", addr)}
                    showMailFlags
                  />
                </div>
              </>
            )}
          />

          {!isOrg &&
            [
              { key: "sendingChurch", title: "Sending Church" },
              { key: "sendingOrg", title: "Sending Org" },
            ].map(({ key, title }) => (
              <EditableSection
                key={key}
                title={title}
                canEdit={canEdit}
                onSaved={reload}
                onSave={(d) => {
                  const { sentByOurChurch, ...rest } = d;
                  return save({
                    [key]: rest,
                    ...(key === "sendingChurch" ? { sentByOurChurch } : {}),
                  });
                }}
                value={{
                  name: p[key]?.name || "",
                  contactFirstName: p[key]?.contactFirstName || "",
                  contactLastName: p[key]?.contactLastName || "",
                  contactEmail: p[key]?.contactEmail || "",
                  phone: p[key]?.phone || "",
                  websiteLink: p[key]?.websiteLink || "",
                  mailingAddress: { ...emptyAddress, ...(p[key]?.mailingAddress || {}) },
                  ...(key === "sendingChurch" ? { sentByOurChurch: p.sentByOurChurch } : {}),
                }}
                view={(v) => (
                  <>
                    {key === "sendingChurch" && (
                      <div style={{ marginBottom: v.name ? "0.75rem" : 0 }}>
                        <Field
                          label={`Sent by ${churchName || "our church"}`}
                          value={v.sentByOurChurch ? "Yes" : "No"}
                        />
                      </div>
                    )}
                    {v.name ? (
                      <>
                        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                          <Field label="Name" value={v.name} />
                          <Field
                            label="Contact"
                            value={[v.contactFirstName, v.contactLastName].filter(Boolean).join(" ")}
                          />
                          <Field label="Contact Email" value={v.contactEmail} />
                          <Field label="Phone" value={v.phone} />
                          <Field
                            label="Website"
                            value={
                              v.websiteLink ? (
                                <a href={v.websiteLink} target="_blank" rel="noreferrer">
                                  {v.websiteLink}
                                </a>
                              ) : null
                            }
                          />
                        </div>
                        <div style={{ marginTop: "0.75rem" }}>
                          <AddressSummary address={v.mailingAddress} />
                        </div>
                      </>
                    ) : (
                      <p style={{ color: "#888" }}>No {title} on file.</p>
                    )}
                  </>
                )}
                edit={(d, set) => (
                  <>
                    {key === "sendingChurch" && (
                      <div className="admin-checkbox-row" style={{ marginBottom: "1rem" }}>
                        <label title="Fills in the Sending Church section below from this church's own info, overwriting anything already there. A later Church Settings change doesn't update this on its own -- use the bulk update on the About Church page for that. Unchecking never clears what's there.">
                          <input
                            type="checkbox"
                            checked={d.sentByOurChurch}
                            onChange={(e) => set("sentByOurChurch", e.target.checked)}
                          />
                          Sent by {churchName || "our church"}
                        </label>
                      </div>
                    )}
                    <div className="form-grid">
                      <label>
                        Name
                        <input value={d.name} onChange={(e) => set("name", e.target.value)} />
                      </label>
                      <label>
                        Contact First Name
                        <input
                          value={d.contactFirstName}
                          onChange={(e) => set("contactFirstName", e.target.value)}
                        />
                      </label>
                      <label>
                        Contact Last Name
                        <input
                          value={d.contactLastName}
                          onChange={(e) => set("contactLastName", e.target.value)}
                        />
                      </label>
                      <label>
                        Contact Email
                        <input value={d.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
                      </label>
                      <label>
                        Phone
                        <input value={d.phone} onChange={(e) => set("phone", e.target.value)} />
                      </label>
                      <label>
                        Website
                        <input value={d.websiteLink} onChange={(e) => set("websiteLink", e.target.value)} />
                      </label>
                    </div>
                    <h4 style={{ marginTop: "1rem" }}>Mailing Address</h4>
                    <AddressFields
                      idPrefix={key}
                      value={d.mailingAddress}
                      onChange={(addr) => set("mailingAddress", addr)}
                    />
                  </>
                )}
              />
            ))}

          <RecordList
            title="Links &amp; Social Media"
            canEdit={canEdit}
            canDelete={canDelete}
            items={collections.links}
            renderItem={(l) => (
              <Field
                label={linkTypeLabel(l.type)}
                value={
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.url}
                  </a>
                }
              />
            )}
            onAdd={() =>
              linkCrud.openAdd({
                type: LINK_TYPES.find((t) => !usedLinkTypes.has(t.value))?.value || "",
                url: "",
              })
            }
            addLabel={collections.links.length >= LINK_TYPES.length ? null : "+ Add Link"}
            onEdit={(l) => linkCrud.openEdit(l.id, { type: l.type, url: l.url })}
            onDelete={(l) =>
              linkCrud.handleDelete(l, (item) => `Delete the ${linkTypeLabel(item.type)} link?`)
            }
          />
        </div>

        {(enabledFeatures.monthlySupport || enabledFeatures.oneTimeNeeds) && (
          <div className="admin-section-group" id="section-financial">
            <h2 className="admin-group-heading">Financial</h2>

            <EditableSection
              title="Supporting Since"
              canEdit={canEdit}
              onSaved={reload}
              onSave={(d) => save({ supportingSince: dateOrNull(d.supportingSince) })}
              value={{ supportingSince: toDateInputValue(p.supportingSince) }}
              view={(v) => (
                <Field label="Supporting Since" value={formatDateLong(v.supportingSince)} showEmpty />
              )}
              edit={(d, set) => (
                <label>
                  Supporting Since
                  <input
                    type="date"
                    value={d.supportingSince}
                    onChange={(e) => set("supportingSince", e.target.value)}
                  />
                </label>
              )}
            />

            {enabledFeatures.monthlySupport && (
              <PartnerSummaryCard
                icon="🤲"
                title="Monthly Support"
                count={collections.supportEntries.length}
                items={supportEntriesLoadMore.visible.map(
                  (e) => `${formatCurrency(e.amount)}/mo as of ${formatDate(e.effectiveDate)}`
                )}
                hasMore={supportEntriesLoadMore.hasMore}
                remaining={supportEntriesLoadMore.remaining}
                onShowMore={supportEntriesLoadMore.showMore}
                actions={canEdit ? [{ label: "+ Add", onClick: openAddSupportEntry }] : []}
              />
            )}

            {enabledFeatures.oneTimeNeeds && (
              <PartnerSummaryCard
                icon="🎁"
                title="One-Time Needs"
                count={collections.needRequests.length}
                items={needRequestsLoadMore.visible.map((n) => ({
                  text: `${truncate(n.description, 60)} · ${formatCurrency(n.requestedAmount)} · ${
                    supportNeedStatus(n).label
                  }`,
                  onClick: () => openNeedDetail(n),
                }))}
                hasMore={needRequestsLoadMore.hasMore}
                remaining={needRequestsLoadMore.remaining}
                onShowMore={needRequestsLoadMore.showMore}
                viewAllTo={`/admin/support/needs?partnerId=${p.id}`}
                actions={canEdit ? [{ label: "+ Add", onClick: openAddNeed }] : []}
              />
            )}
          </div>
        )}

        <div className="admin-section-group" id="section-trips">
          <h2 className="admin-group-heading">Mission Trips</h2>

          {enabledFeatures.trips && (
            <PartnerSummaryCard
              icon="✈️"
              title="Mission Trips"
              count={collections.trips.length}
              items={tripsLoadMore.visible.map((t) => ({
                text: `${t.name || t.type || "Trip"}${t.startDate ? ` · ${formatDate(t.startDate)}` : ""}${
                  t.status ? ` · ${t.status}` : ""
                }`,
                onClick: () => navigate(`/admin/trips/${t.id}`),
              }))}
              hasMore={tripsLoadMore.hasMore}
              remaining={tripsLoadMore.remaining}
              onShowMore={tripsLoadMore.showMore}
              viewAllTo={`/admin/trips?partnerId=${p.id}`}
              actions={
                canEdit
                  ? [
                      {
                        label: "+ Add",
                        onClick: () => navigate(`/admin/trips?partnerId=${p.id}&newTrip=1`),
                      },
                    ]
                  : []
              }
            />
          )}

          <EditableSection
            title="Trip Capacity"
            canEdit={canEdit}
            onSaved={reload}
            onSave={(d) =>
              save({
                tripTeamSizeMin: d.tripTeamSizeMin === "" ? null : Number(d.tripTeamSizeMin),
                tripTeamSizeMax: d.tripTeamSizeMax === "" ? null : Number(d.tripTeamSizeMax),
                tripSeasonNotes: d.tripSeasonNotes || null,
                tripLogisticsNotes: d.tripLogisticsNotes || null,
              })
            }
            value={{
              tripTeamSizeMin: p.tripTeamSizeMin ?? "",
              tripTeamSizeMax: p.tripTeamSizeMax ?? "",
              tripSeasonNotes: p.tripSeasonNotes || "",
              tripLogisticsNotes: p.tripLogisticsNotes || "",
            }}
            view={(v) => (
              <>
                <Field
                  label="Team Size"
                  value={
                    v.tripTeamSizeMin !== "" || v.tripTeamSizeMax !== ""
                      ? `${v.tripTeamSizeMin === "" ? "?" : v.tripTeamSizeMin} – ${
                          v.tripTeamSizeMax === "" ? "?" : v.tripTeamSizeMax
                        }`
                      : null
                  }
                  showEmpty
                />
                <div style={{ marginTop: "0.75rem" }}>
                  <Field label="Best Time of Year / Duration Notes" value={v.tripSeasonNotes} />
                  <Field label="Lodging &amp; Logistics Notes" value={v.tripLogisticsNotes} />
                </div>
                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #eee" }}>
                  <RecordList
                    bare
                    canEdit={canEdit}
                    canDelete={canDelete}
                    items={collections.tripTypes}
                    renderItem={(t) => <Field label="Type" value={t.type} />}
                    addLabel="+ Add Type"
                    onAdd={() => tripTypeCrud.openAdd({ type: "" })}
                    onEdit={(t) => tripTypeCrud.openEdit(t.id, { type: t.type })}
                    onDelete={(t) => tripTypeCrud.handleDelete(t, (item) => `Delete "${item.type}"?`)}
                    emptyMessage="No trip types on file."
                  />
                </div>
              </>
            )}
            edit={(d, set) => (
              <>
                <div className="form-grid">
                  <label>
                    Min Team Size
                    <input
                      type="number"
                      min="0"
                      value={d.tripTeamSizeMin}
                      onChange={(e) => set("tripTeamSizeMin", e.target.value)}
                    />
                  </label>
                  <label>
                    Max Team Size
                    <input
                      type="number"
                      min="0"
                      value={d.tripTeamSizeMax}
                      onChange={(e) => set("tripTeamSizeMax", e.target.value)}
                    />
                  </label>
                </div>
                <label style={{ marginTop: "1rem" }}>
                  Best Time of Year / Duration Notes
                  <textarea
                    rows={2}
                    value={d.tripSeasonNotes}
                    onChange={(e) => set("tripSeasonNotes", e.target.value)}
                  />
                </label>
                <label style={{ marginTop: "0.75rem" }}>
                  Lodging &amp; Logistics Notes
                  <textarea
                    rows={2}
                    value={d.tripLogisticsNotes}
                    onChange={(e) => set("tripLogisticsNotes", e.target.value)}
                  />
                </label>
                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #eee" }}>
                  <RecordList
                    bare
                    canEdit={canEdit}
                    canDelete={canDelete}
                    items={collections.tripTypes}
                    renderItem={(t) => <Field label="Type" value={t.type} />}
                    addLabel="+ Add Type"
                    onAdd={() => tripTypeCrud.openAdd({ type: "" })}
                    onEdit={(t) => tripTypeCrud.openEdit(t.id, { type: t.type })}
                    onDelete={(t) => tripTypeCrud.handleDelete(t, (item) => `Delete "${item.type}"?`)}
                    emptyMessage="No trip types on file."
                  />
                </div>
              </>
            )}
          />
        </div>

        <div className="admin-section-group" id="section-communication">
          <h2 className="admin-group-heading">Communication</h2>

          {enabledFeatures.prayerRequests && (
            <EditableSection
              title="Last Prayed w/ Congregation"
              canEdit={canEdit}
              onSaved={reload}
              onSave={(d) =>
                save({ lastPrayedWithCongregationAt: dateOrNull(d.lastPrayedWithCongregationAt) })
              }
              value={{ lastPrayedWithCongregationAt: toDateInputValue(p.lastPrayedWithCongregationAt) }}
              view={(v) => (
                <Field
                  label="Last Prayed w/ Congregation"
                  value={formatDateLong(v.lastPrayedWithCongregationAt, { fallback: "Never" })}
                  showEmpty
                />
              )}
              edit={(d, set) => (
                <label>
                  Last Prayed w/ Congregation
                  <input
                    type="date"
                    value={d.lastPrayedWithCongregationAt}
                    onChange={(e) => set("lastPrayedWithCongregationAt", e.target.value)}
                  />
                </label>
              )}
              actions={
                canEdit ? (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={markPrayedWithCongregationToday}
                  >
                    Mark Prayed Today
                  </button>
                ) : null
              }
            />
          )}

          {enabledFeatures.prayerRequests && (
            <PartnerSummaryCard
              icon="🙏"
              title="Prayer Requests"
              count={collections.prayerRequests.length}
              items={prayerRequestsLoadMore.visible.map((r) => ({
                text: `${truncate(r.requestText, 60)} · ${r.category === "strategic" ? "Strategic" : "Situational"}`,
                onClick: () => openPrayerDetail(r),
              }))}
              hasMore={prayerRequestsLoadMore.hasMore}
              remaining={prayerRequestsLoadMore.remaining}
              onShowMore={prayerRequestsLoadMore.showMore}
              viewAllTo={`/admin/prayer-requests?partnerId=${p.id}`}
              actions={canEdit ? [{ label: "+ Add", onClick: openAddPrayerRequest }] : []}
            />
          )}

          {enabledFeatures.partnerFiles && (
            <PartnerSummaryCard
              icon="📰"
              title="Newsletters & Docs"
              count={collections.files.length}
              items={filesLoadMore.visible.map((f) => ({
                text: `${f.title || f.fileName} · ${fileKindLabel(f.kind)} · ${formatDate(f.receivedDate)}`,
                onClick: () => openFileDetail(f),
              }))}
              hasMore={filesLoadMore.hasMore}
              remaining={filesLoadMore.remaining}
              onShowMore={filesLoadMore.showMore}
              viewAllTo={`/admin/partner-files?partnerId=${p.id}`}
              actions={canEdit ? [{ label: "+ Upload", onClick: openUploadFile }] : []}
            />
          )}

          <RecordList
            title="Church Visits"
            canEdit={canEdit}
            canDelete={canDelete}
            items={churchVisitsLoadMore.visible}
            renderItem={(v) => (
              <>
                <Field label="Visit Date" value={formatDateLong(v.visitDate)} showEmpty />
                <Field label="Notes" value={v.notes} />
              </>
            )}
            onAdd={() => churchVisitCrud.openAdd({ visitDate: "", notes: "" })}
            onEdit={(v) =>
              churchVisitCrud.openEdit(v.id, {
                visitDate: toDateInputValue(v.visitDate),
                notes: v.notes || "",
              })
            }
            onDelete={(v) =>
              churchVisitCrud.handleDelete(
                v,
                (item) => `Delete the visit on ${formatDateLong(item.visitDate)}?`
              )
            }
            emptyMessage="No visits on file."
            hasMore={churchVisitsLoadMore.hasMore}
            remaining={churchVisitsLoadMore.remaining}
            onShowMore={churchVisitsLoadMore.showMore}
          />

          {!isOrg && (
            <RecordList
              title="Furlough"
              canEdit={canEdit}
              canDelete={canDelete}
              items={furloughsLoadMore.visible}
              renderItem={(f) => (
                <>
                  <Field label="Start Date" value={formatDateLong(f.startDate)} showEmpty />
                  <Field
                    label="End Date"
                    value={f.endDate ? formatDateLong(f.endDate) : "Ongoing"}
                    showEmpty
                  />
                  <Field label="Notes" value={f.notes} />
                </>
              )}
              onAdd={() => furloughCrud.openAdd({ startDate: "", endDate: "", notes: "" })}
              onEdit={(f) =>
                furloughCrud.openEdit(f.id, {
                  startDate: toDateInputValue(f.startDate),
                  endDate: toDateInputValue(f.endDate),
                  notes: f.notes || "",
                })
              }
              onDelete={(f) =>
                furloughCrud.handleDelete(
                  f,
                  (item) => `Delete the furlough starting ${formatDateLong(item.startDate)}?`
                )
              }
              emptyMessage="No furlough history on file."
              hasMore={furloughsLoadMore.hasMore}
              remaining={furloughsLoadMore.remaining}
              onShowMore={furloughsLoadMore.showMore}
            />
          )}
        </div>
      </div>

      {activeModal === "add-prayer" && (
        <QuickActionModal title="Add Prayer Request" onClose={closeModal} onSubmit={submitAddPrayerRequest}>
          <PrayerRequestFormFields
            form={prayerForm}
            setForm={setPrayerForm}
            files={collections.files}
            mode="create"
            hasEnabledChannel={hasEnabledChannel}
            canApproveNow={canApproveNow}
            enabledFeatures={enabledFeatures}
          />
        </QuickActionModal>
      )}

      {activeModal === "answer-prayer" && (
        <QuickActionModal title="Mark Answered" onClose={closeModal} onSubmit={submitMarkAnswered}>
          <div className="form-grid">
            <label>
              Date Answered
              <input
                type="date"
                value={prayerAnswerForm.dateAnswered}
                onChange={(e) => setPrayerAnswerForm((f) => ({ ...f, dateAnswered: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              How was it answered? (optional)
              <input
                value={prayerAnswerForm.answeredNote}
                onChange={(e) => setPrayerAnswerForm((f) => ({ ...f, answeredNote: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {activeModal === "view-prayer" &&
        prayerDetail &&
        (canEdit ? (
          <QuickActionModal title="Prayer Request" onClose={closeModal} onSubmit={submitPrayerDetail}>
            <PrayerRequestFormFields
              form={prayerDetail.form}
              setForm={setPrayerDetailForm}
              files={collections.files}
              mode="edit"
            />
            {prayerDetail.form.status !== "answered" && (
              <button
                type="button"
                className="btn secondary small"
                style={{ marginTop: "0.5rem" }}
                onClick={() => {
                  const request = collections.prayerRequests.find((r) => r.id === prayerDetail.id);
                  closeModal();
                  openMarkAnswered(request);
                }}
              >
                Mark Answered
              </button>
            )}
          </QuickActionModal>
        ) : (
          <Modal title="Prayer Request" onClose={closeModal}>
            <Field
              label="Category"
              value={prayerDetail.form.category === "strategic" ? "Strategic" : "Situational"}
            />
            <Field label="Date Received" value={formatDateLong(prayerDetail.form.dateReceived)} />
            <Field label="Prayer Request" value={prayerDetail.form.requestText} />
            <Field label="Admin Notes" value={prayerDetail.form.notes} />
            <Field
              label="Answered"
              value={
                prayerDetail.form.status === "answered"
                  ? `${formatDateLong(prayerDetail.form.dateAnswered)}${
                      prayerDetail.form.answeredNote ? ` -- ${prayerDetail.form.answeredNote}` : ""
                    }`
                  : "Not yet answered"
              }
              showEmpty
            />
          </Modal>
        ))}

      {activeModal === "add-need" && (
        <QuickActionModal title="Add One-Time Need" onClose={closeModal} onSubmit={submitAddNeed}>
          <SupportNeedFormFields
            form={needForm}
            setForm={setNeedForm}
            files={collections.files}
            mode="create"
            hasEnabledChannel={hasEnabledChannel}
            canApproveNow={canApproveNow}
            enabledFeatures={enabledFeatures}
          />
        </QuickActionModal>
      )}

      {activeModal === "decide-need" && (
        <QuickActionModal title="Record Decision" onClose={closeModal} onSubmit={submitRecordDecision}>
          <div className="form-grid">
            <label>
              Approved Amount ($)
              <input
                type="number"
                min="0"
                value={needDecisionForm.approvedAmount}
                onChange={(e) => setNeedDecisionForm((f) => ({ ...f, approvedAmount: e.target.value }))}
                required
              />
            </label>
            <label>
              Approved Date
              <input
                type="date"
                value={needDecisionForm.approvedDate}
                onChange={(e) => setNeedDecisionForm((f) => ({ ...f, approvedDate: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Decision Note
              <input
                value={needDecisionForm.decisionNote}
                onChange={(e) => setNeedDecisionForm((f) => ({ ...f, decisionNote: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {activeModal === "view-need" &&
        needDetail &&
        (canEdit ? (
          <QuickActionModal title="One-Time Need" onClose={closeModal} onSubmit={submitNeedDetail}>
            <SupportNeedFormFields
              form={needDetail.form}
              setForm={setNeedDetailForm}
              files={collections.files}
              mode="edit"
            />
            {needDetail.form.approvedAmount == null && (
              <button
                type="button"
                className="btn secondary small"
                style={{ marginTop: "0.5rem" }}
                onClick={() => {
                  const need = collections.needRequests.find((n) => n.id === needDetail.id);
                  closeModal();
                  openRecordDecision(need);
                }}
              >
                Record Decision
              </button>
            )}
          </QuickActionModal>
        ) : (
          <Modal title="One-Time Need" onClose={closeModal}>
            <Field label="Description" value={needDetail.form.description} />
            <Field label="Requested Amount" value={formatCurrency(needDetail.form.requestedAmount)} />
            <Field label="Request Date" value={formatDateLong(needDetail.form.requestDate)} />
            <Field label="Notes" value={needDetail.form.notes} />
            <Field
              label="Approved"
              value={
                needDetail.form.approvedAmount != null
                  ? `${formatCurrency(needDetail.form.approvedAmount)} on ${formatDateLong(needDetail.form.approvedDate)}`
                  : "Not yet decided"
              }
              showEmpty
            />
            <Field label="Decision Note" value={needDetail.form.decisionNote} />
          </Modal>
        ))}

      {activeModal === "add-support" && (
        <QuickActionModal title="Add Support Entry" onClose={closeModal} onSubmit={submitAddSupportEntry}>
          <SupportEntryFormFields form={supportEntryForm} setForm={setSupportEntryForm} />
        </QuickActionModal>
      )}

      {activeModal === "add-file" && (
        <QuickActionModal title="Upload File" onClose={closeModal} onSubmit={submitUploadFile}>
          <PartnerFileFormFields
            form={fileForm}
            setForm={setFileForm}
            fileInput={
              <label style={{ gridColumn: "1 / -1" }}>
                File (PDF, Word, Excel, .eml, JPG, or PNG)
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.eml,image/jpeg,image/png"
                  onChange={(e) => setFileBlob(e.target.files[0] || null)}
                  required
                />
              </label>
            }
          />
        </QuickActionModal>
      )}

      {activeModal === "view-file" &&
        fileDetail &&
        (canEdit ? (
          <QuickActionModal title="Newsletter / Doc" onClose={closeModal} onSubmit={submitFileDetail}>
            <PartnerFileFormFields form={fileDetail.form} setForm={setFileDetailForm} />
            <button
              type="button"
              className="btn secondary small"
              style={{ marginTop: "0.5rem" }}
              onClick={() => window.open(`/api/partner-files/${fileDetail.id}/download`, "_blank")}
            >
              Download File
            </button>
          </QuickActionModal>
        ) : (
          <Modal title="Newsletter / Doc" onClose={closeModal}>
            <Field label="Kind" value={fileKindLabel(fileDetail.form)} />
            <Field label="Title" value={fileDetail.form.title} />
            <Field label="Received Date" value={formatDateLong(fileDetail.form.receivedDate)} />
            <Field label="Notes" value={fileDetail.form.notes} />
            <button
              type="button"
              className="btn secondary small"
              style={{ marginTop: "0.5rem" }}
              onClick={() => window.open(`/api/partner-files/${fileDetail.id}/download`, "_blank")}
            >
              Download File
            </button>
          </Modal>
        ))}

      {adultCrud.form && (
        <QuickActionModal
          title={adultCrud.editingId ? "Edit Adult" : "Add Adult"}
          onClose={adultCrud.close}
          onSubmit={() =>
            adultCrud.submit({
              partnerId: p.id,
              firstName: adultCrud.form.firstName.trim(),
              lastName: adultCrud.form.lastName.trim() || null,
              phone1: adultCrud.form.phone1.trim() || null,
              phone2: adultCrud.form.phone2.trim() || null,
              email: adultCrud.form.email.trim() || null,
              birthday: adultCrud.form.birthday || null,
            })
          }
        >
          <div className="form-grid">
            <label>
              First Name
              <input
                value={adultCrud.form.firstName}
                onChange={(e) => adultCrud.setForm((f) => ({ ...f, firstName: e.target.value }))}
                required
              />
            </label>
            <label>
              Last Name
              <input
                value={adultCrud.form.lastName}
                onChange={(e) => adultCrud.setForm((f) => ({ ...f, lastName: e.target.value }))}
              />
            </label>
            <label>
              Birthday
              <input
                type="date"
                value={adultCrud.form.birthday}
                onChange={(e) => adultCrud.setForm((f) => ({ ...f, birthday: e.target.value }))}
              />
            </label>
            <label>
              Phone 1
              <input
                value={adultCrud.form.phone1}
                onChange={(e) => adultCrud.setForm((f) => ({ ...f, phone1: e.target.value }))}
              />
            </label>
            <label>
              Phone 2
              <input
                value={adultCrud.form.phone2}
                onChange={(e) => adultCrud.setForm((f) => ({ ...f, phone2: e.target.value }))}
              />
            </label>
            <label>
              Email
              <input
                value={adultCrud.form.email}
                onChange={(e) => adultCrud.setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {childCrud.form && (
        <QuickActionModal
          title={childCrud.editingId ? "Edit Child" : "Add Child"}
          onClose={childCrud.close}
          onSubmit={() =>
            childCrud.submit({
              partnerId: p.id,
              firstName: childCrud.form.firstName.trim(),
              lastName: childCrud.form.lastName.trim() || null,
              birthday: childCrud.form.birthday || null,
            })
          }
        >
          <div className="form-grid">
            <label>
              First Name
              <input
                value={childCrud.form.firstName}
                onChange={(e) => childCrud.setForm((f) => ({ ...f, firstName: e.target.value }))}
                required
              />
            </label>
            <label>
              Last Name
              <input
                value={childCrud.form.lastName}
                onChange={(e) => childCrud.setForm((f) => ({ ...f, lastName: e.target.value }))}
              />
            </label>
            <label>
              Birthday
              <input
                type="date"
                value={childCrud.form.birthday}
                onChange={(e) => childCrud.setForm((f) => ({ ...f, birthday: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {languageCrud.form && (
        <QuickActionModal
          title={languageCrud.editingId ? "Edit Language" : "Add Language"}
          onClose={languageCrud.close}
          onSubmit={() =>
            languageCrud.submit({
              partnerId: p.id,
              language: languageCrud.form.language.trim(),
              proficiency: languageCrud.form.proficiency || null,
            })
          }
        >
          <div className="form-grid">
            <label>
              Language
              <input
                value={languageCrud.form.language}
                onChange={(e) => languageCrud.setForm((f) => ({ ...f, language: e.target.value }))}
                list="partner-language-names"
                placeholder="Start typing a language..."
                required
              />
              {/* A datalist, not a hard <select> -- same reasoning as
                  AddressFields.jsx's Country field. */}
              <datalist id="partner-language-names">
                {LANGUAGE_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label>
              Proficiency (ILR scale)
              <select
                value={languageCrud.form.proficiency}
                onChange={(e) => languageCrud.setForm((f) => ({ ...f, proficiency: e.target.value }))}
              >
                <option value="">Not assessed yet</option>
                {PROFICIENCY_LEVELS.map((lvl) => (
                  <option key={lvl.value} value={lvl.value}>
                    {lvl.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </QuickActionModal>
      )}

      {tripTypeCrud.form && (
        <QuickActionModal
          title={tripTypeCrud.editingId ? "Edit Trip Type" : "Add Trip Type"}
          onClose={tripTypeCrud.close}
          onSubmit={() => tripTypeCrud.submit({ partnerId: p.id, type: tripTypeCrud.form.type.trim() })}
        >
          <div className="form-grid">
            <label style={{ gridColumn: "1 / -1" }}>
              Trip Type
              <PresetOrCustomSelect
                value={tripTypeCrud.form.type}
                onChange={(v) => tripTypeCrud.setForm((f) => ({ ...f, type: v }))}
                presets={TRIP_TYPE_PRESETS}
                placeholder="e.g. Photography"
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {linkCrud.form && (
        <QuickActionModal
          title={linkCrud.editingId ? "Edit Link" : "Add Link"}
          onClose={linkCrud.close}
          onSubmit={() =>
            linkCrud.submit({ partnerId: p.id, type: linkCrud.form.type, url: linkCrud.form.url.trim() })
          }
        >
          <div className="form-grid">
            <label>
              Type
              <select
                value={linkCrud.form.type}
                onChange={(e) => linkCrud.setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {LINK_TYPES.filter((t) => t.value === linkCrud.form.type || !usedLinkTypes.has(t.value)).map(
                  (t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  )
                )}
              </select>
            </label>
            <label>
              URL
              <input
                value={linkCrud.form.url}
                onChange={(e) => linkCrud.setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://..."
                required
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {furloughCrud.form && (
        <QuickActionModal
          title={furloughCrud.editingId ? "Edit Furlough" : "Add Furlough"}
          onClose={furloughCrud.close}
          onSubmit={() =>
            furloughCrud.submit({
              partnerId: p.id,
              startDate: furloughCrud.form.startDate,
              endDate: furloughCrud.form.endDate || null,
              notes: furloughCrud.form.notes.trim() || null,
            })
          }
        >
          <div className="form-grid">
            <label>
              Start Date
              <input
                type="date"
                value={furloughCrud.form.startDate}
                onChange={(e) => furloughCrud.setForm((f) => ({ ...f, startDate: e.target.value }))}
                required
              />
            </label>
            <label title="Leave blank for an ongoing furlough with no settled return date.">
              End Date
              <input
                type="date"
                value={furloughCrud.form.endDate}
                onChange={(e) => furloughCrud.setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input
                value={furloughCrud.form.notes}
                onChange={(e) => furloughCrud.setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {churchVisitCrud.form && (
        <QuickActionModal
          title={churchVisitCrud.editingId ? "Edit Church Visit" : "Add Church Visit"}
          onClose={churchVisitCrud.close}
          onSubmit={() =>
            churchVisitCrud.submit({
              partnerId: p.id,
              visitDate: churchVisitCrud.form.visitDate,
              notes: churchVisitCrud.form.notes.trim() || null,
            })
          }
        >
          <div className="form-grid">
            <label>
              Visit Date
              <input
                type="date"
                value={churchVisitCrud.form.visitDate}
                onChange={(e) => churchVisitCrud.setForm((f) => ({ ...f, visitDate: e.target.value }))}
                required
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Notes
              <input
                value={churchVisitCrud.form.notes}
                onChange={(e) => churchVisitCrud.setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
        </QuickActionModal>
      )}

      {confirmElement}
    </div>
  );
}
