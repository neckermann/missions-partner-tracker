# Infrastructure: standing up the AWS reference deployment

A step-by-step walkthrough for provisioning the AWS infrastructure this
project's reference deployment uses, from nothing. If you just want the
high-level shape of what's involved, see
[ADMIN_GUIDE.md § Deploying to production](ADMIN_GUIDE.md#deploying-to-production)
first — this document is the detailed version of that.

Nothing here is AWS-exclusive by requirement (see
[ADMIN_GUIDE.md § Deploying anywhere else](ADMIN_GUIDE.md#deploying-anywhere-else)
for other providers) — this is simply the fully-worked example, using the
same pieces this project's own`.github/workflows/backend-deploy-aws.yml`
template targets.

## What you're building

One deployable app (Node/Express, serving both the API and the built
frontend) on Elastic Beanstalk, fronted by CloudFront for TLS and a
custom domain, backed by a Postgres database and an S3 bucket for file
uploads. GitHub Actions builds and deploys it on every push to `main`.

```
Browser ──HTTPS──▶ CloudFront (custom domain + ACM cert)
                       │  HTTP, port 80
                       ▼
                 Elastic Beanstalk (Node.js platform, single instance)
                       │
              ┌────────┴────────┐
              ▼                 ▼
         Postgres (Neon)     S3 bucket (uploads)
```

## Prerequisites

- An AWS account with billing set up.
- A registered domain name, ideally with its DNS already hosted in
  [Route53](https://console.aws.amazon.com/route53/) — this makes the
  certificate validation step a few clicks instead of a manual DNS edit
  at a third-party registrar. (You can still use an external DNS
  provider; you'll just add the validation/alias records there by hand.)
- The [AWS CLI](https://aws.amazon.com/cli/) installed and configured
  with credentials that can create the resources below (an IAM user or
  role with broad admin access is easiest for this one-time setup; you'll
  create a narrower-scoped user for ongoing deploys in Step 4).
- A GitHub fork of this repo, with `backend/**`/`frontend/**` pushable.

## Step 1: Database

Any Postgres works. [Neon](https://neon.tech) is a good default — free
tier, serverless (scales to zero when idle), and needs no infrastructure
of your own to manage:

1. Create a Neon project and a database within it.
2. Copy the connection string it gives you (`postgresql://...?sslmode=require`)
   — this is your `DATABASE_URL`.

If you'd rather self-host or use RDS, any Postgres 13+ works identically
— this app has no Neon-specific code, just a connection string.

## Step 2: S3 bucket for file uploads

This is a *separate* bucket from the one Elastic Beanstalk creates for
its own deploy artifacts in Step 3 — this one holds the app's actual
uploaded content (partner photos, logos, newsletter PDFs).

```bash
aws s3api create-bucket \
  --bucket your-church-missions-assets \
  --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2
```
(Pick any region; `us-east-2` here is just this project's own reference
choice. Bucket names are globally unique across all of AWS, so pick
something specific to your church rather than a generic name.)

The app writes public-read objects under `missionaries/*`,
`organizations/*`, and `settings/*` (bucket policy, not per-object ACLs)
and private objects under `newsletters/*` (served only via short-lived
pre-signed URLs) — see `backend/src/utils/s3.js` and the bucket policy
example in [ADMIN_GUIDE.md § File storage](ADMIN_GUIDE.md#file-storage-s3)
for the exact policy JSON to attach.

This becomes your `S3_BUCKET_NAME` env var.

## Step 3: Elastic Beanstalk application + environment

1. **Create the application:**
   ```bash
   aws elasticbeanstalk create-application --application-name your-app-name --region us-east-2
   ```
2. **Create the environment** — Node.js platform, single instance (a
   small church deployment doesn't need a load balancer/auto-scaling
   group; `t3.micro` is plenty):
   ```bash
   aws elasticbeanstalk create-environment \
     --application-name your-app-name \
     --environment-name your-app-name-env \
     --solution-stack-name "64bit Amazon Linux 2023 v6.x running Node.js 24" \
     --option-settings \
       Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.micro \
       Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=SingleInstance \
     --region us-east-2
   ```
   (Run `aws elasticbeanstalk list-available-solution-stacks --query "SolutionStacks[?contains(@,'Node.js')]"`
   to see current platform version strings — they update over time.)
3. **Set every env var** the app needs (see
   [ADMIN_GUIDE.md § Environment variables](ADMIN_GUIDE.md#environment-variables)
   for the full list) as Elastic Beanstalk environment properties:
   ```bash
   aws elasticbeanstalk update-environment \
     --application-name your-app-name \
     --environment-name your-app-name-env \
     --option-settings \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value="postgresql://..." \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=SESSION_SECRET,Value="$(openssl rand -base64 48)" \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=FIELD_ENCRYPTION_KEY,Value="$(openssl rand -base64 32)" \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=S3_BUCKET_NAME,Value="your-church-missions-assets" \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=AWS_REGION,Value="us-east-2" \
       Namespace=aws:elasticbeanstalk:application:environment,OptionName=NODE_ENV,Value="production" \
     --region us-east-2
   ```
   `APP_BASE_URL` gets set later (Step 9), once you know the app's real
   public URL. The EC2 instance role Elastic Beanstalk creates
   automatically (`aws-elasticbeanstalk-ec2-role`) already has S3 access,
   so no separate credentials are needed on the instance itself for file
   uploads.

The app's own `backend/.platform/nginx/conf.d/uploads.conf` (already in
the repo) raises Elastic Beanstalk's default nginx body-size cap from 1MB
to 20MB, since newsletter PDF uploads routinely exceed the default — this
ships automatically with every deploy, nothing to configure by hand.

## Step 4: IAM deploy user (for GitHub Actions)

Create a narrowly-scoped IAM user that only GitHub Actions uses — never
your own broad-access credentials:

```bash
aws iam create-user --user-name your-app-github-deploy
```

Attach a policy scoped to exactly what the deploy workflow needs — create
your own application version and roll it out, plus read/write to the S3
bucket Elastic Beanstalk auto-created for deploy artifacts (**not** the
app's own upload bucket from Step 2 — this is a different, EB-managed
bucket, typically named `elasticbeanstalk-<region>-<account-id>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ElasticBeanstalkDeploy",
      "Effect": "Allow",
      "Action": [
        "elasticbeanstalk:CreateApplicationVersion",
        "elasticbeanstalk:UpdateEnvironment",
        "elasticbeanstalk:DescribeEnvironments",
        "elasticbeanstalk:DescribeEvents",
        "elasticbeanstalk:DescribeApplicationVersions",
        "elasticbeanstalk:DescribeConfigurationSettings"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DeployBucketAccess",
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": [
        "arn:aws:s3:::elasticbeanstalk-us-east-2-<your-account-id>",
        "arn:aws:s3:::elasticbeanstalk-us-east-2-<your-account-id>/*"
      ]
    }
  ]
}
```

```bash
aws iam create-policy --policy-name YourAppBeanstalkDeploy --policy-document file://deploy-policy.json
aws iam attach-user-policy --user-name your-app-github-deploy --policy-arn arn:aws:iam::<account-id>:policy/YourAppBeanstalkDeploy
aws iam create-access-key --user-name your-app-github-deploy
```
Save the resulting access key ID and secret — you'll only see the secret
once.

## Step 5: GitHub repository configuration

In your fork, **Settings → Secrets and variables → Actions**:

- **Secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (from Step 4).
- **Variables**: `EB_APP_NAME`, `EB_ENV_NAME` (from Step 3), `AWS_REGION`,
  `EB_DEPLOY_S3_BUCKET` (the EB-managed bucket from Step 4 — find its
  name with `aws elasticbeanstalk describe-configuration-settings` or in
  the console under the environment's S3 storage).

Then enable the workflow: **Actions tab → "Deploy backend to Elastic
Beanstalk" → Enable workflow** (it ships disabled since there's nothing
to deploy to until you've done the above).

## Step 6: First deploy

Push to `main` (or re-run the workflow manually from the Actions tab). It
builds the frontend, zips it together with the backend, and rolls it out
to Elastic Beanstalk. Confirm it worked:

```bash
curl https://your-app-name-env.<random>.<region>.elasticbeanstalk.com/api/health
# {"ok":true}
```

Then create your first login:
```bash
# From a machine with DATABASE_URL pointed at the same production database
cd backend
node prisma/createAdmin.js you@yourchurch.org "SomeStrongPassword!"
```

At this point the app is fully working at its default Elastic Beanstalk
domain — everything past this point is about a custom domain and HTTPS,
not core functionality.

## Step 7: CloudFront distribution

Elastic Beanstalk's own domain works over HTTPS already (via its default
certificate), but a custom domain needs its own certificate, and
CloudFront is the standard way to attach one — plus it gives you edge
caching for static assets for free.

1. **Create a distribution** with the Elastic Beanstalk environment's
   domain as a custom origin:
   ```bash
   aws cloudfront create-distribution --distribution-config '{
     "CallerReference": "your-app-'"$(date +%s)"'",
     "Comment": "your-app-name",
     "Enabled": true,
     "Origins": {
       "Quantity": 1,
       "Items": [{
         "Id": "eb-origin",
         "DomainName": "your-app-name-env.<random>.<region>.elasticbeanstalk.com",
         "CustomOriginConfig": {
           "HTTPPort": 80,
           "HTTPSPort": 443,
           "OriginProtocolPolicy": "http-only",
           "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] }
         }
       }]
     },
     "DefaultCacheBehavior": {
       "TargetOriginId": "eb-origin",
       "ViewerProtocolPolicy": "redirect-to-https",
       "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
       "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac",
       "AllowedMethods": {
         "Quantity": 7,
         "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
         "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] }
       }
     }
   }'
   ```
   `OriginProtocolPolicy: http-only` is deliberate — CloudFront terminates
   TLS for the browser and talks plain HTTP to Elastic Beanstalk
   internally, which is the normal pattern (Elastic Beanstalk's own nginx
   isn't set up for HTTPS by default, and doesn't need to be). The cache
   policy ID is AWS's managed `Managed-CachingDisabled` (this is a
   dynamic app, not a static site — you don't want CloudFront caching API
   responses or serving a stale HTML shell); the origin request policy ID
   is `Managed-AllViewerExceptHostHeader` (forwards everything — headers,
   cookies, query strings — the app needs, e.g. the session cookie and
   `Content-Type` on uploads).
2. Note the distribution's own domain name from the response
   (`*.cloudfront.net`) — the app already works at this domain over
   HTTPS. The custom domain comes next.

## Step 8: Custom domain with a free managed certificate

1. **Request a certificate** — must be in `us-east-1` regardless of where
   your other resources live, since that's the only region CloudFront
   reads certificates from:
   ```bash
   aws acm request-certificate \
     --domain-name yourchurch.org \
     --subject-alternative-names www.yourchurch.org \
     --validation-method DNS \
     --region us-east-1
   ```
2. **Get the DNS validation records** it wants:
   ```bash
   aws acm describe-certificate --certificate-arn <arn-from-above> --region us-east-1 \
     --query "Certificate.DomainValidationOptions[].ResourceRecord"
   ```
3. **Add those CNAME records** to your domain's DNS. If it's in Route53:
   ```bash
   aws route53 change-resource-record-sets --hosted-zone-id <your-zone-id> --change-batch '{
     "Changes": [{
       "Action": "UPSERT",
       "ResourceRecordSet": {
         "Name": "<Name from above>",
         "Type": "CNAME",
         "TTL": 300,
         "ResourceRecords": [{ "Value": "<Value from above>" }]
       }
     }]
   }'
   ```
   Validation is usually quick (often under a couple of minutes once the
   record is live) if your DNS is already in Route53; check with
   `aws acm describe-certificate ... --query "Certificate.Status"` until
   it reads `ISSUED`.
4. **Attach the certificate and your domain names** to the CloudFront
   distribution from Step 7 (`Aliases` + `ViewerCertificate` in its
   config — via `aws cloudfront update-distribution` with the
   distribution's current `ETag`, or the console's "Custom SSL
   Certificate" + "Alternate domain names (CNAMEs)" fields).
5. **Point your DNS at the distribution.** For the apex/root domain, use
   a Route53 **Alias** record (type A) targeting the CloudFront
   distribution's domain, with hosted zone ID `Z2FDTNDATAQYW2` (a fixed,
   AWS-wide constant for CloudFront — the same for every distribution).
   For `www`, a plain CNAME to the distribution's domain works fine
   (only the apex needs the Alias trick, since a bare domain can't hold a
   CNAME per the DNS spec):
   ```bash
   aws route53 change-resource-record-sets --hosted-zone-id <your-zone-id> --change-batch '{
     "Changes": [
       {
         "Action": "UPSERT",
         "ResourceRecordSet": {
           "Name": "yourchurch.org.",
           "Type": "A",
           "AliasTarget": {
             "HostedZoneId": "Z2FDTNDATAQYW2",
             "DNSName": "<your-distribution>.cloudfront.net.",
             "EvaluateTargetHealth": false
           }
         }
       },
       {
         "Action": "UPSERT",
         "ResourceRecordSet": {
           "Name": "www.yourchurch.org.",
           "Type": "CNAME",
           "TTL": 300,
           "ResourceRecords": [{ "Value": "<your-distribution>.cloudfront.net" }]
         }
       }
     ]
   }'
   ```
6. Wait for the distribution to report `"Status": "Deployed"`
   (`aws cloudfront get-distribution --id <id> --query "Distribution.Status"`)
   — usually a handful of minutes for global propagation, though
   individual edge locations often pick up the change sooner.

## Step 9: Finish env var setup

Set `APP_BASE_URL` to your real domain now that you have one:
```bash
aws elasticbeanstalk update-environment \
  --application-name your-app-name --environment-name your-app-name-env \
  --option-settings Namespace=aws:elasticbeanstalk:application:environment,OptionName=APP_BASE_URL,Value="https://yourchurch.org" \
  --region us-east-2
```
This is only load-bearing if you configure SSO (see
[ADMIN_GUIDE.md § Single sign-on](ADMIN_GUIDE.md#single-sign-on-sso)) —
it's what builds the callback URL registered with your identity provider.

## Verification checklist

- `curl https://yourchurch.org/api/health` → `{"ok":true}`
- `curl -I https://yourchurch.org/` shows a valid certificate for your
  domain (not the default `*.cloudfront.net` one)
- The public site and `/login` both load correctly at the real domain
- A real login round-trip works (email/password → lands on `/admin`),
  and the browser shows an `httpOnly` session cookie was set
- `www.yourchurch.org` also resolves and serves the app

## Ongoing operations

Once this is all standing, day-to-day operations (rotating secrets,
adding SSO providers, database backups, rate limiting, troubleshooting)
are covered in [ADMIN_GUIDE.md § Security operations](ADMIN_GUIDE.md#security-operations)
onward — this document is only for the one-time infrastructure setup.
