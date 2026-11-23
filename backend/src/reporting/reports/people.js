// Contacts and access: mailing list, and who can sign in.
const { z } = require("zod");
const { flag, oneOf, ymd } = require("../params");

const mailingList = {
  id: "mailing-list",
  group: "contacts",
  label: "Mailing list",
  question: "Who gets mail or packages, and where do they go?",
  params: z.object({ deliver: oneOf(["mail", "packages", "either"], "mail"), includeArchived: flag(false) }),
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
        partner: params.includeArchived ? {} : { archived: false },
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
  fetch: (params, { prisma }) =>
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
        expiresAt: true,
        passwordHash: true,
      },
    }),
  compute(users, params, { today }) {
    const rows = users.map((u) => ({
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
      role: u.role,
      status: !u.active
        ? "Inactive"
        : u.expiresAt && u.expiresAt < today
          ? "Expired"
          : !u.passwordHash
            ? "Awaiting setup"
            : "Active",
      mfa: u.mfaEnabled ? "On" : u.mfaSetupRequired ? "Required, not set up" : "Off",
      lastLogin: ymd(u.lastLoginAt),
      expires: ymd(u.expiresAt),
    }));
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
