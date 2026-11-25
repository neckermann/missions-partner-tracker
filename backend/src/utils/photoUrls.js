// Queries returning Photo rows omit `bytes` (see routes/photos.js and the Photo
// model in schema.prisma) and call this to turn the row's id into `photo.url`.
function withPhotoUrl(photo) {
  return { ...photo, url: `/api/photos/${photo.id}/raw` };
}

function withPhotoUrls(photos) {
  return (photos || []).map(withPhotoUrl);
}

module.exports = { withPhotoUrl, withPhotoUrls };
