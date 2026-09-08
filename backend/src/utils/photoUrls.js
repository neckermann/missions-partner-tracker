// Every query that returns Photo rows omits `bytes` (see routes/photos.js
// and the Photo model comment in schema.prisma) and calls this instead to
// turn the row's id into the URL the frontend expects at `photo.url`.
function withPhotoUrl(photo) {
  return { ...photo, url: `/api/photos/${photo.id}/raw` };
}

function withPhotoUrls(photos) {
  return (photos || []).map(withPhotoUrl);
}

module.exports = { withPhotoUrl, withPhotoUrls };
