# Flipcloud setup checklist

## Google OAuth
1. Create/select the Google Cloud project used by Flipcloud.
2. Enable Cloud Resource Manager API and Service Usage API.
3. Configure an OAuth Web Client.
4. Add `http://localhost:3000/auth/google/callback` for local development.
5. For production, add the exact HTTPS callback URL.
6. Put the client ID/secret in environment variables; never in frontend code.

## FCM
The supplied Firebase Web config and VAPID public key are wired into the browser.
The browser must grant notification permission. FCM cannot bypass that permission.

The starter registers an FCM token with `/api/fcm-token`, but the current session-cookie storage is NOT suitable for production token persistence.
For production:
- authenticate the user,
- store tokens in Firestore,
- use Firebase Admin SDK / FCM HTTP v1 from a trusted backend,
- remove invalid tokens,
- implement token rotation,
- add rate limits and audit logs.

## Important
Google Cloud actions are performed against the connected user's project. A successful OAuth login does not guarantee that the user has IAM permission to perform every action.


## Production persistence and notifications

For durable subscriptions and server-side FCM delivery, configure these Vercel environment variables:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (store the private key with `\n` escaped line breaks)
- `FLIPCLOUD_INTERNAL_BILLING_KEY` (random server-only key for internal v4 billing operations)

The browser Firebase configuration and FCM VAPID key are public client configuration; do not treat them as server secrets.

Flutterwave production also requires:

- `FLW_CLIENT_ID`
- `FLW_CLIENT_SECRET`
- `FLW_PUBLIC_KEY`
- `FLW_SECRET_KEY`
- `FLW_MONTHLY_PLAN_ID`
- `FLW_YEARLY_PLAN_ID`
- `FLW_REDIRECT_URL`
- `FLW_SECRET_HASH`

Set the Flutterwave webhook URL to `/flw-webhook`. Keep `FLW_ALLOW_V3_WEBHOOK=false` unless you intentionally need the legacy verification path.

## Free vs Pro

Free: catalog, search, project inspect, Firebase starter preset, gcloud export, requirement scanner (15/day), website scan (3/day), single API enables (10/day), Cost Guard score and counts, deep-scan preview.
Pro: unlimited use, all 9 presets, bulk apply across up to 10 projects, Cost Guard details with one-tap disable, Terraform/JSON/report exports, deep website scan.

Logic lives in `lib/pro.js`. Change quotas in `FREE_LIMITS`, presets in `PRESETS`. Trials (`trials`) and daily usage (`usage`) are stored in Firestore; without Firebase Admin variables they fall back to the session cookie and memory, which users can reset.
A paid subscription counts as active for one billing period plus 3 days after its last successful payment webhook.
