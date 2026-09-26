# Flipcloud 1.1

Flipcloud is a lightweight developer cloud setup assistant.

## Included
- Google OAuth with offline access
- Project listing
- Enabled-service inspection
- Single and batch API enabling
- Rule-based code requirement scanner
- Search across the API/tool catalog
- Firebase GitHub account sign-in
- FCM browser token registration
- Responsive black/white developer UI
- Collapsible navigation
- Permission-aware actions with Ignore/Enable choices
- No paid AI dependency

## Third-party value without Flipcloud paying provider usage
The catalog includes integrations developers commonly need: GitHub, npm/package metadata, jsDelivr/unpkg, Firebase, FCM, Cloudflare and common Google services. Public metadata can be fetched client-side where appropriate. Flipcloud should not proxy paid provider traffic.

## GitHub
Firebase GitHub authentication signs users into Flipcloud. Repository operations are a separate concern and should use a GitHub App with minimum repository permissions. Configure the GitHub provider in Firebase Authentication and add the app credentials there.

## Production requirements
- Persist sessions/tokens securely server-side.
- Store FCM tokens in Firestore keyed to authenticated users.
- Send FCM through Firebase Admin SDK or FCM HTTP v1 from a trusted backend.
- Add CSRF/state protection, rate limiting, audit logging and token rotation.
- Do not commit .env or private keys.
- Some Google Cloud operations require IAM roles. Flipcloud cannot bypass Google permissions.
- Enabling an API does not make the underlying service free; any applicable usage charges remain on the user's project.

## Flipcloud Pro billing

Plans:
- Monthly: $3.99 / ₦4,500
- Yearly: $30 / ₦40,000

Flutterwave v4 is wired for server-side authentication and recurring tokenized card charges. Flutterwave's current documentation describes v4 recurring charges using a stored/tokenized `payment_method_id` plus `customer_id` and `recurring: true`.

For the initial hosted subscription enrollment, Flutterwave's documented Payment Plan/Standard checkout currently uses the Standard API/payment-plan mechanism. This is kept server-side because the Flutterwave secret must never reach the browser. After enrollment/tokenization, v4 recurring charges can be used for recurring billing.

Required production variables:
`FLW_CLIENT_ID`, `FLW_CLIENT_SECRET`, `FLW_ENV`, `FLW_PUBLIC_KEY`, `FLW_SECRET_KEY`, `FLW_MONTHLY_PLAN_ID`, `FLW_YEARLY_PLAN_ID`, `FLW_REDIRECT_URL`.

Do not put any Flutterwave secret in frontend JavaScript or GitHub. Verify successful payments server-side and use Flutterwave webhooks before granting/renewing Pro access. Flutterwave recommends webhooks for subscription charges and payment status changes.


### Complimentary accounts
`server.js` hardcodes one email (`ilemobayotolulope11092003@gmail.com`) and one GitHub username (`wytzbot`) as always-free Pro accounts (`COMPLIMENTARY_EMAILS` / `COMPLIMENTARY_GITHUB_USERNAMES`). Matching accounts skip Flutterwave entirely and get an active "complimentary" subscription. The GitHub match is tied to a Firebase-ID-token-verified session (via `/api/github-session`), but the email match is on whatever email is typed into the checkout form, consistent with the rest of the checkout flow, which does not otherwise verify email ownership.

## Google Workspace Marketplace
See MARKETPLACE.md and marketplace/STORE-LISTING.md. Flipcloud is intended to be listed as a production Web app integration. Replace YOUR-DOMAIN with the real production domain before submitting.

## Production verification
The callback page never grants Pro by itself. Use the transaction verification endpoint and verified Flutterwave webhooks before activating or renewing entitlements. For multi-device persistent entitlements, connect a persistent datastore (Firestore is a suitable low-cost option) and authenticate the Firebase user on the backend.
