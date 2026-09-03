const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Region and credentials come from the environment: AWS_REGION is read
// automatically, and on Elastic Beanstalk credentials come from the EC2
// instance role (aws-elasticbeanstalk-ec2-role) rather than any keys in code.
//
// AWS S3 is the default. To point this at an S3-compatible service instead
// (Cloudflare R2, Backblaze B2, self-hosted MinIO), set S3_ENDPOINT to that
// service's endpoint URL — R2/MinIO also typically need
// S3_FORCE_PATH_STYLE=true, since they don't support AWS's
// bucket-as-subdomain URL style.
const s3 = new S3Client({
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  ...(process.env.S3_FORCE_PATH_STYLE === "true" ? { forcePathStyle: true } : {}),
});
const BUCKET = process.env.S3_BUCKET_NAME;

// The base URL a browser hits directly for public objects. Defaults to
// AWS's virtual-hosted-style URL; set S3_PUBLIC_URL_BASE (no trailing
// slash) to override it for non-AWS providers — e.g. an R2 bucket's
// public/custom domain, or wherever MinIO is reachable from the internet.
function publicBaseUrl() {
  return process.env.S3_PUBLIC_URL_BASE || `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
}

function publicUrlFor(key) {
  return `${publicBaseUrl()}/${key}`;
}

async function uploadImageToS3(buffer, key, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return publicUrlFor(key);
}

// Only deletes objects that actually live in our bucket (safe to call with
// arbitrary/legacy string values that might not be S3 URLs at all).
async function deleteFromS3IfOwned(url) {
  const prefix = `${publicBaseUrl()}/`;
  if (!url || !url.startsWith(prefix)) return;
  const key = url.slice(prefix.length);
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// For private files (newsletters) — same bucket, but these keys are
// deliberately NOT covered by the bucket's public-read policy (see the
// Newsletter model comment in schema.prisma), so no public URL is returned.
// Access is always through getPresignedDownloadUrl below.
async function uploadPrivateFileToS3(buffer, key, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

// Short-lived signed URL for reading a private object — regenerated fresh
// on every download request rather than stored, so there's nothing
// long-lived to leak. ResponseContentDisposition makes the browser save it
// with the original filename instead of the raw S3 key.
async function getPresignedDownloadUrl(key, filename) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, "")}"`,
  });
  return getSignedUrl(s3, command, { expiresIn: 300 });
}

async function deleteFromS3ByKey(key) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// DANGEROUS — deletes every object under each given prefix, no confirmation,
// no per-object check against what's still referenced in the database. Only
// meant for scripts/reset-demo-data.js, where the database itself was just
// fully wiped and recreated (so nothing under these prefixes can possibly
// still be referenced) — never call this from a normal request handler.
// Prefixes must be passed explicitly rather than defaulting to "everything
// in the bucket", so a bucket that ever picks up unrelated content doesn't
// get silently swept too.
async function deleteAllObjectsUnderPrefixes(prefixes) {
  for (const prefix of prefixes) {
    let continuationToken;
    do {
      const { Contents, IsTruncated, NextContinuationToken } = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken })
      );
      if (Contents?.length) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: Contents.map((o) => ({ Key: o.Key })) },
          })
        );
      }
      continuationToken = IsTruncated ? NextContinuationToken : undefined;
    } while (continuationToken);
  }
}

module.exports = {
  uploadImageToS3,
  deleteFromS3IfOwned,
  uploadPrivateFileToS3,
  getPresignedDownloadUrl,
  deleteFromS3ByKey,
  deleteAllObjectsUnderPrefixes,
};
