// Every query that returns Photo rows omits `bytes` (see routes/photos.js
// and the Photo model comment in schema.prisma) and calls this instead to
// turn the row's id into the URL the frontend already expects at
// `photo.url` — the API response shape is unchanged from when `url` was a
// real column pointing at S3, only where that string comes from changed.
function withPhotoUrl(photo) {
  return { ...photo, url: `/api/photos/${photo.id}/raw` };
}

function withPhotoUrls(photos) {
  return (photos || []).map(withPhotoUrl);
}

module.exports = { withPhotoUrl, withPhotoUrls };
