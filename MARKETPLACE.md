# Google Workspace Marketplace submission checklist

Flipcloud is prepared to be published as a **Web app** integration.

Google's current Marketplace requirements say a web app must be production-ready and provide a universal navigation URL. The Marketplace SDK is configured in Google Cloud, not by a ZIP-only manifest.

## Marketplace SDK
1. Enable Google Workspace Marketplace SDK in the Flipcloud Google Cloud project.
2. Open Marketplace SDK → App Configuration.
3. Choose **Public** only when you are ready for review. Visibility cannot be changed after saving.
4. Choose **Web app** under App Integrations.
5. Set the Universal Navigation URL to `PUBLIC_APP_URL`.
6. Add the OAuth scopes exactly matching the Google OAuth consent screen.
7. Add developer information.
8. Create the Store Listing with the supplied icon assets.
9. Add Terms, Privacy and Support URLs:
   - `/terms`
   - `/privacy`
   - `/support`
   - `/setup`
10. Add screenshots showing actual production functionality.
11. Provide pricing accurately: $3.99/₦4,500 monthly and $30/₦40,000 yearly if these are the prices offered.
12. Provide a reviewer test account if required for paid features.
13. Complete OAuth verification if the scopes trigger it.
14. Submit the public listing for review.

## OAuth scopes currently requested
- openid
- email
- profile
- https://www.googleapis.com/auth/cloudplatformprojects.readonly
- https://www.googleapis.com/auth/serviceusage

Do not add broad Drive/Gmail/Sheets scopes unless Flipcloud actually uses those user-data APIs. The API catalog can explain APIs without requesting user-data access.

## Important Marketplace distinction
Flipcloud's API catalog is broader than its OAuth access. Listing an API in the catalog does NOT mean Flipcloud requests that API's user data. Keep permissions minimal.

## Production requirements
- HTTPS
- Real production domain
- Valid privacy, terms and support pages
- Working OAuth consent screen
- Google Workspace Marketplace SDK configuration
- No development URLs in the public listing
- No unfinished or dead functionality
- Functional billing and cancellation/support flow
- Verified payment webhooks before granting paid access


Official preparation references:
- https://developers.google.com/workspace/marketplace/enable-configure-sdk
- https://developers.google.com/workspace/marketplace/about-app-review
- https://developers.google.com/workspace/marketplace/create-listing
- https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen
