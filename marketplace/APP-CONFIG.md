# Marketplace SDK values

Use these values when configuring the Google Workspace Marketplace SDK.

**Application name:** Flipcloud

**App integration:** Web app

**Universal navigation URL:** `PUBLIC_APP_URL` (your production HTTPS Flipcloud URL)

**Installation:** Individual + Admin Install is appropriate for a general public web app unless your final product requires admin-only installation.

**OAuth scopes:**
- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/cloudplatformprojects.readonly`
- `https://www.googleapis.com/auth/serviceusage`

**Required listing links:**
- Privacy: `https://YOUR-DOMAIN/privacy`
- Terms: `https://YOUR-DOMAIN/terms`
- Support: `https://YOUR-DOMAIN/support`
- Setup: `https://YOUR-DOMAIN/setup`

**Icons:**
- `icon-48.png`
- `icon-96.png`
- `icon-128.png`
- `icon-256.png`

Replace `YOUR-DOMAIN` before saving the listing. The web app must already be deployed and fully functional at the universal navigation URL.
