// Contacts and access: mailing list, and who can sign in.
const { z } = require("zod");
const { flag, oneOf, ymd, sendingChurchParam, sendingChurchField } = require("../params");
const { sendingChurchPartnerWhere } = require("../../utils/sendingChurch");
const { GRANT_SELECT, summarizeGrants, guestInactiveReason } = require("../../utils/tripAccessRules");

const mailingList = {
  id: "mailing-list",
  group: "contacts",
  label: "Mailing list",
  question: "Who gets mail or packages, and where do they go?",
  params: z.object({
    deliver: oneOf(["mail", "packages", "either"], "mail"),
    includeArchived: flag(false),
    sendingChurch: sendingChurchParam,
  }),
  fields: [
    {
      name: "deliver",
      label: "Receives",
      type: "select",
      options: [
        { value: "mail", label: "Mail" },
        { value: "packages", label: "Packages" },
        { value: "either", label: "Mail or packages" },
      ],
    },
    sendingChurchField,
    { name: "includeArchived", label: "Include archived partners", type: "checkbox" },
  ],
  columns: [
    { key: "partnerName", label: "Partner" },
    { key: "line1", label: "Address", sensitive: true },
    { key: "line2", label: "Address 2", sensitive: true },
    { key: "city", label: "City", sensitive: true },
    { key: "region", label: "State/Region", sensitive: true },
    { key: "postalCode", label: "Postal code", sensitive: true },
    { key: "country", label: "Country", sensitive: true },
    { key: "receives", label: "Receives" },
  ],
  fetch: (params, { prisma }) =>
    prisma.address.findMany({
      where: {
        partner: {
          ...(params.includeArchived ? {} : { archived: false }),
          ...(sendingChurchPartnerWhere(params.sendingChurch) || {}),
        },
        OR:
          params.deliver === "mail"
            ? [{ receiveMail: true }]
            : params.deliver === "packages"
              ? [{ receivePackages: true }]
              : [{ receiveMail: true }, { receivePackages: true }],
      },
      select: {
        type: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        stateProvinceRegion: true,
        postalCode: true,
        country: true,
        receiveMail: true,
        receivePackages: true,
        partner: { select: { displayName: true, isRestricted: true } },
      },
    }),
  compute(addresses) {
    const rows = addresses.map((a) => ({
      partnerName: a.partner.displayName,
      line1: a.addressLine1,
      line2: a.addressLine2,
      city: a.city,
      region: a.stateProvinceRegion,
      postalCode: a.postalCode,
      country: a.country,
      receives: [a.receiveMail && "Mail", a.receivePackages && "Packages"].filter(Boolean).join(" + "),
      _restricted: a.partner.isRestricted,
    }));
    rows.sort((a, b) => a.partnerName.localeCompare(b.partnerName));
    return {
      rows,
      summary: [
        { label: "Addresses", value: rows.length },
        { label: "Countries", value: new Set(rows.map((r) => r.country).filter(Boolean)).size },
      ],
      notes: ["Restricted partners' addresses are blanked whenever a report leaves the signed-in app."],
    };
  },
};

const usersAccess = {
  id: "users-access",
  group: "system",
  label: "Users & access",
  question: "Who can sign in, and are they protected with MFA?",
  roles: ["admin"],
  params: z.object({ includeInactive: flag(false) }),
  fields: [{ name: "includeInactive", label: "Include inactive users", type: "checkbox" }],
  columns: [
    { key: "name", label: "User" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
    { key: "mfa", label: "MFA" },
    { key: "lastLogin", label: "Last sign-in", type: "date" },
    { key: "expires", label: "Access expires", type: "date" },
  ],
  fetch: async (params, { prisma }) => {
    const [users, settings] = await Promise.all([
      prisma.user.findMany({
        where: params.includeInactive ? {} : { active: true },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          active: true,
          lastLoginAt: true,
          mfaEnabled: true,
          mfaSetupRequired: true,
          passwordHash: true,
          // A guest's access comes from its grants (#356), so "expires" and
          // "Expired" are worked out from those, not from a column on User.
          tripAccess: { select: GRANT_SELECT },
        },
      }),
      prisma.churchSettings.findUnique({ where: { id: "singleton" }, select: { requireTwoFactor: true } }),
    ]);
    // The church-wide requirement (#385) applies to every account.
    return users.map((u) => ({ ...u, twoFactorRequired: settings?.requireTwoFactor === true }));
  },
  compute(users) {
    const rows = users.map((u) => {
      const grants = u.role === "guest" ? summarizeGrants(u.tripAccess) : [];
      const reason = guestInactiveReason(u, grants);
      // When the last of a guest's active grants lapses; blank when any of
      // them never does (a trip with no end date) or for the full roles.
      const live = grants.filter((g) => g.active);
      const expiry =
        live.length === 0 || live.some((g) => !g.effectiveExpiresAt)
          ? null
          : new Date(Math.max(...live.map((g) => g.effectiveExpiresAt.getTime())));
      return {
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
        role: u.role,
        status: !u.active
          ? "Inactive"
          : reason === "expired"
            ? "Expired"
            : reason === "no_access"
              ? "No access"
              : !u.passwordHash
                ? "Awaiting setup"
                : "Active",
        mfa: u.mfaEnabled ? "On" : u.mfaSetupRequired || u.twoFactorRequired ? "Required, not set up" : "Off",
        lastLogin: ymd(u.lastLoginAt),
        expires: ymd(expiry),
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return {
      rows,
      summary: [
        { label: "Users", value: rows.length },
        { label: "MFA on", value: rows.filter((r) => r.mfa === "On").length },
        { label: "MFA off", value: rows.filter((r) => r.mfa !== "On").length },
      ],
      notes: ["Admin only. Never included in shared or scheduled reports."],
    };
  },
};

module.exports = { reports: [mailingList, usersAccess] };
