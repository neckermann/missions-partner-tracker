// Whether anything public can show a partner: the directory, the map, or the prayer sign-up (its
// digest names public partners). The printed booklet is not counted: it lists prayer requests, not
// partners, and has its own switch. When none is on, "Show on public site"
// ticks, "Not public" pills and the Public filter would be controls for something that does not
// exist, so screens hide them. The stored value is untouched and returns when a page is switched on.
export function publicSiteOn(enabledFeatures) {
  const f = enabledFeatures || {};
  return Boolean(f.publicDirectory || f.publicMap || f.publicPrayerDigest);
}
