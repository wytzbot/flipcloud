// Flipcloud Pro: entitlements, free-tier quotas and the premium feature routes.
// Design rule: nothing that was free before is taken away. Pro adds power
// (bulk, cost control, exports, deep scans, unlimited use) on top.
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";

const DAY = 864e5;
const GRACE = 3 * DAY;
const PERIOD = { monthly: 31 * DAY, yearly: 366 * DAY };
export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);

export const FREE_LIMITS = { scan: 3, analyze: 15, enable: 10 };
const LIMIT_LABEL = { scan: "website scans", analyze: "code analyses", enable: "API enables" };
const FEATURE_NAME = {
  presets: "Stack presets",
  bulk: "Bulk enable",
  costguard: "Cost Guard",
  export: "Terraform, JSON and report exports",
  deepscan: "Deep website scan"
};

// Services the free "Enable recommended" button may batch-enable.
export const STARTER_SERVICES = [
  "firebase.googleapis.com", "identitytoolkit.googleapis.com",
  "firestore.googleapis.com", "fcm.googleapis.com"
];

export const PRESETS = [
  { id: "firebase-starter", name: "Firebase starter", free: true, desc: "Auth, Firestore, push and Firebase management.", services: STARTER_SERVICES },
  { id: "web-hosting", name: "Web app + hosting", desc: "Firebase starter plus Hosting and Storage.", services: [...STARTER_SERVICES, "firebasehosting.googleapis.com", "firebasestorage.googleapis.com", "storage.googleapis.com"] },
  { id: "serverless", name: "Serverless backend", desc: "Cloud Run, Functions, builds, secrets and logs.", services: ["run.googleapis.com", "cloudfunctions.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com", "logging.googleapis.com"] },
  { id: "ai-app", name: "AI app", desc: "Vertex AI, Gemini API and Secret Manager.", services: ["aiplatform.googleapis.com", "generativelanguage.googleapis.com", "secretmanager.googleapis.com"] },
  { id: "maps-app", name: "Maps & location", desc: "Maps JS, Places, Geocoding and Directions.", services: ["maps-backend.googleapis.com", "places-backend.googleapis.com", "geocoding-backend.googleapis.com", "directions-backend.googleapis.com"] },
  { id: "workspace", name: "Workspace automation", desc: "Sheets, Drive, Gmail, Calendar and Docs.", services: ["sheets.googleapis.com", "drive.googleapis.com", "gmail.googleapis.com", "calendar-json.googleapis.com", "docs.googleapis.com"] },
  { id: "realtime-push", name: "Realtime & scheduled push", desc: "FCM, Firestore, Pub/Sub and Cloud Scheduler.", services: ["fcm.googleapis.com", "firestore.googleapis.com", "pubsub.googleapis.com", "cloudscheduler.googleapis.com"] },
  { id: "analytics", name: "Data & analytics", desc: "BigQuery, Storage and Pub/Sub.", services: ["bigquery.googleapis.com", "storage.googleapis.com", "pubsub.googleapis.com"] },
  { id: "cost-control", name: "Cost control", desc: "Billing, budgets, monitoring and logging.", services: ["cloudbilling.googleapis.com", "billingbudgets.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com"] }
];

// Risk knowledge used by Cost Guard. "high"/"medium" can generate real bills.
const INFO = {
  "compute.googleapis.com": ["Compute Engine", "high", "VMs and disks bill while they exist, even when idle."],
  "container.googleapis.com": ["Kubernetes Engine", "high", "Clusters bill continuously for nodes and management."],
  "sqladmin.googleapis.com": ["Cloud SQL", "high", "Database instances run and bill 24/7."],
  "redis.googleapis.com": ["Memorystore Redis", "high", "Instances bill hourly whether used or not."],
  "spanner.googleapis.com": ["Cloud Spanner", "high", "Provisioned capacity bills continuously."],
  "aiplatform.googleapis.com": ["Vertex AI", "high", "Model calls and deployed endpoints bill per use or per hour."],
  "bigquery.googleapis.com": ["BigQuery", "medium", "Queries bill by data scanned."],
  "run.googleapis.com": ["Cloud Run", "medium", "Bills per request and CPU time; set max instances."],
  "cloudfunctions.googleapis.com": ["Cloud Functions", "medium", "Bills per invocation and compute time."],
  "generativelanguage.googleapis.com": ["Gemini API", "medium", "Bills per token on paid tiers."],
  "maps-backend.googleapis.com": ["Maps JavaScript API", "medium", "Billed per load; restrict your API keys."],
  "places-backend.googleapis.com": ["Places API", "medium", "Billed per request; restrict your API keys."],
  "geocoding-backend.googleapis.com": ["Geocoding API", "medium", "Billed per request; restrict your API keys."],
  "directions-backend.googleapis.com": ["Directions API", "medium", "Billed per request; restrict your API keys."],
  "maps.googleapis.com": ["Maps API", "medium", "Billed per request; restrict your API keys."],
  "vision.googleapis.com": ["Cloud Vision", "medium", "Bills per image after the free quota."],
  "translate.googleapis.com": ["Cloud Translation", "medium", "Bills per character after the free quota."],
  "speech.googleapis.com": ["Speech-to-Text", "medium", "Bills per audio minute after the free quota."],
  "texttospeech.googleapis.com": ["Text-to-Speech", "medium", "Bills per character after the free quota."],
  "storage.googleapis.com": ["Cloud Storage", "low", "Bills for stored data and egress."],
  "firestore.googleapis.com": ["Cloud Firestore", "low", "Free quota, then per read/write/delete."],
  "pubsub.googleapis.com": ["Pub/Sub", "low", "Bills for message volume above the free quota."],
  "cloudbuild.googleapis.com": ["Cloud Build", "low", "Build minutes bill after the free tier."],
  "artifactregistry.googleapis.com": ["Artifact Registry", "low", "Stored images bill monthly."],
  "iam.googleapis.com": ["Cloud IAM", "security", "Review service accounts and delete unused keys."],
  "iamcredentials.googleapis.com": ["IAM Credentials", "security", "Used for token impersonation; keep access narrow."],
  "secretmanager.googleapis.com": ["Secret Manager", "security", "Audit who can read secrets."],
  "gmail.googleapis.com": ["Gmail API", "security", "Touches user mail; verify OAuth scopes."],
  "drive.googleapis.com": ["Google Drive API", "security", "Touches user files; verify OAuth scopes."]
};
// Never offered for one-click disabling: doing so breaks Flipcloud or the project.
const PROTECTED = new Set(["serviceusage.googleapis.com", "cloudresourcemanager.googleapis.com", "oauth2.googleapis.com"]);

const SVC_RE = /^[a-z0-9.-]+\.googleapis\.com$/;
const PROJECT_RE = /^[a-z0-9-]{6,30}$/;
const emailOf = req => String(req.session?.user?.email || req.session?.github?.email || req.session?.subscription?.email || "").toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

export function registerPro(app, ctx) {
  const { google, requireGoogle, getDb, sessionIsComplimentary, getCatalog } = ctx;
  const mem = new Map();

  async function readDoc(col, id) {
    const db = getDb(); if (!db) return null;
    try { const s = await db.collection(col).doc(id).get(); return s.exists ? s.data() : null } catch { return null }
  }
  async function writeDoc(col, id, data) {
    const db = getDb(); if (!db) return false;
    try { await db.collection(col).doc(id).set(data, { merge: true }); return true } catch { return false }
  }

  async function getEntitlement(req) {
    if (req._ent) return req._ent;
    const email = emailOf(req);
    const ent = { pro: false, source: "free", plan: null, renewal: null, email: email || null, complimentary: false,
      trial: { available: false, active: false, used: false, endsAt: null, days: TRIAL_DAYS } };
    if (sessionIsComplimentary(req)) {
      Object.assign(ent, { pro: true, source: "complimentary", plan: "complimentary", complimentary: true });
    } else if (email) {
      const sub = (await readDoc("subscriptions", email)) || req.session?.subscription;
      if (sub && sub.status === "active") {
        const age = Date.now() - (Date.parse(sub.updatedAt) || 0);
        // A paid period plus a short grace; each successful renewal webhook refreshes updatedAt.
        if (age <= (PERIOD[sub.plan] || PERIOD.monthly) + GRACE) Object.assign(ent, { pro: true, source: "paid", plan: sub.plan, renewal: sub.updatedAt });
      }
    }
    if (email && !ent.complimentary) {
      const tr = (await readDoc("trials", email)) || (req.session?.trial?.email === email ? req.session.trial : null);
      if (tr) {
        ent.trial.used = true; ent.trial.endsAt = tr.endsAt;
        if (Date.parse(tr.endsAt) > Date.now()) { ent.trial.active = true; if (!ent.pro) Object.assign(ent, { pro: true, source: "trial", plan: "trial" }); }
      } else ent.trial.available = true;
    }
    req._ent = ent; return ent;
  }

  const ident = req => { const e = emailOf(req); return e ? "e:" + e : "ip:" + req.ip };
  const usageId = (req, key) => crypto.createHash("sha1").update(ident(req)).digest("hex").slice(0, 20) + "_" + key + "_" + today();
  async function getUsed(req, key) {
    const id = usageId(req, key);
    if (getDb()) return (await readDoc("usage", id))?.n || 0;
    return mem.get(id) || 0;
  }
  async function bump(req, key) {
    const id = usageId(req, key), db = getDb();
    if (db) { try { await db.collection("usage").doc(id).set({ n: FieldValue.increment(1), day: today() }, { merge: true }) } catch {} }
    else mem.set(id, (mem.get(id) || 0) + 1);
  }

  // Free users get a daily allowance; Pro is unlimited. Fails open so a storage hiccup never blocks anyone.
  const meter = key => async (req, res, next) => {
    try {
      const ent = await getEntitlement(req);
      if (ent.pro) return next();
      const limit = FREE_LIMITS[key];
      if ((await getUsed(req, key)) >= limit)
        return res.status(402).json({ error: "LIMIT_REACHED", feature: key, limit, upgrade: true, trialAvailable: ent.trial.available,
          message: `You've used today's ${limit} free ${LIMIT_LABEL[key]}. Pro removes the limit.` });
      await bump(req, key);
    } catch {}
    next();
  };
  const proOnly = feature => async (req, res, next) => {
    const ent = await getEntitlement(req);
    if (ent.pro) return next();
    res.status(402).json({ error: "PRO_REQUIRED", feature, upgrade: true, trialAvailable: ent.trial.available, message: `${FEATURE_NAME[feature]} is a Pro feature.` });
  };

  // ---- Free-tier quotas on existing routes (registered before them in server.js) ----
  app.post("/api/website-scan", meter("scan"));
  app.post("/api/analyze", meter("analyze"));
  app.post("/api/enable-api", meter("enable"));
  app.post("/api/batch-enable", async (req, res, next) => {
    const s = req.body?.services;
    if (Array.isArray(s) && s.length && s.every(x => STARTER_SERVICES.includes(x))) return next();
    return proOnly("bulk")(req, res, next);
  });

  // ---- Status ----
  async function status(req, res) {
    const ent = await getEntitlement(req);
    const usage = {};
    if (!ent.pro) for (const k of Object.keys(FREE_LIMITS)) usage[k] = { used: await getUsed(req, k), limit: FREE_LIMITS[k] };
    res.json({ active: ent.pro, plan: ent.plan, renewal: ent.renewal, email: ent.email, complimentary: ent.complimentary,
      source: ent.source, trial: ent.trial, usage, persistent: Boolean(getDb()) });
  }
  app.get("/api/billing/status", status);
  app.get("/api/entitlement", status);

  app.post("/api/trial/start", async (req, res) => {
    const ent = await getEntitlement(req);
    if (!ent.email) return res.status(401).json({ error: "SIGN_IN_REQUIRED", message: "Sign in with Google or GitHub to start your free trial." });
    if (ent.pro && ent.source !== "trial") return res.json({ success: true, message: "You already have Pro." });
    if (!ent.trial.available) return res.status(409).json({ error: "TRIAL_USED", message: "This account has already used its free trial." });
    const tr = { email: ent.email, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + TRIAL_DAYS * DAY).toISOString() };
    await writeDoc("trials", ent.email, tr);
    req.session.trial = tr;
    res.json({ success: true, endsAt: tr.endsAt, message: `Your ${TRIAL_DAYS}-day Pro trial is active.` });
  });

  // ---- Presets ----
  app.get("/api/presets", async (req, res) => {
    const ent = await getEntitlement(req);
    res.json({ pro: ent.pro, presets: PRESETS.map(p => ({ id: p.id, name: p.name, desc: p.desc, count: p.services.length, locked: !p.free && !ent.pro })) });
  });

  app.post("/api/presets/apply", requireGoogle, async (req, res) => {
    const { presetId } = req.body || {};
    const preset = PRESETS.find(p => p.id === presetId);
    const ids = [...new Set(Array.isArray(req.body?.projectIds) ? req.body.projectIds : [])];
    if (!preset) return res.status(400).json({ error: "INVALID_PRESET", message: "Unknown preset." });
    if (!ids.length || ids.length > 10 || !ids.every(x => PROJECT_RE.test(x || ""))) return res.status(400).json({ error: "INVALID_PROJECTS", message: "Choose 1–10 valid projects." });
    const ent = await getEntitlement(req);
    if (!ent.pro && !preset.free) return res.status(402).json({ error: "PRO_REQUIRED", feature: "presets", upgrade: true, trialAvailable: ent.trial.available, message: "This preset is a Pro feature." });
    if (!ent.pro && ids.length > 1) return res.status(402).json({ error: "PRO_REQUIRED", feature: "bulk", upgrade: true, trialAvailable: ent.trial.available, message: "Applying to several projects at once is a Pro feature." });
    const su = google.serviceusage({ version: "v1", auth: req.googleAuth });
    const results = await Promise.all(ids.map(async projectId => {
      try { await su.services.batchEnable({ parent: `projects/${projectId}`, requestBody: { serviceIds: preset.services } }); return { projectId, ok: true } }
      catch (e) { return { projectId, ok: false, error: e?.errors?.[0]?.message || e?.message || "Request failed" } }
    }));
    res.json({ success: results.some(r => r.ok), preset: preset.id, services: preset.services.length, results });
  });

  // ---- Audit / Cost Guard ----
  async function listEnabled(auth, projectId) {
    const su = google.serviceusage({ version: "v1", auth });
    const out = []; let pageToken;
    for (let i = 0; i < 5; i++) {
      const r = await su.services.list({ parent: `projects/${projectId}`, filter: "state:ENABLED", pageSize: 200, pageToken });
      out.push(...(r.data.services || []).map(x => x.config?.name).filter(Boolean));
      pageToken = r.data.nextPageToken; if (!pageToken) break;
    }
    return out;
  }
  const friendly = s => INFO[s]?.[0] || getCatalog().find(x => x.service === s)?.name || s;
  function analyze(services) {
    const items = services.map(s => ({ service: s, name: friendly(s), risk: INFO[s]?.[1] || "info", note: INFO[s]?.[2] || "", protected: PROTECTED.has(s) }));
    const counts = { high: 0, medium: 0, low: 0, security: 0, info: 0 };
    items.forEach(i => counts[i.risk]++);
    const score = Math.max(0, 100 - counts.high * 12 - counts.medium * 5 - counts.low - counts.security * 2);
    const order = { high: 0, medium: 1, security: 2, low: 3, info: 4 };
    items.sort((a, b) => order[a.risk] - order[b.risk] || a.name.localeCompare(b.name));
    return { items, counts, score, flagged: counts.high + counts.medium };
  }

  app.get("/api/audit/:projectId", requireGoogle, async (req, res) => {
    if (!PROJECT_RE.test(req.params.projectId || "")) return res.status(400).json({ error: "INVALID_PROJECT", message: "That project ID is invalid." });
    try {
      const a = analyze(await listEnabled(req.googleAuth, req.params.projectId));
      const ent = await getEntitlement(req);
      const base = { projectId: req.params.projectId, total: a.items.length, score: a.score, counts: a.counts, flagged: a.flagged };
      if (ent.pro) return res.json({ ...base, pro: true, findings: a.items.filter(i => i.risk !== "info") });
      res.json({ ...base, pro: false, locked: a.flagged + a.counts.security,
        teaser: a.items.filter(i => i.risk === "high" || i.risk === "medium").slice(0, 1).map(i => ({ risk: i.risk })) });
    } catch (e) { res.status(502).json({ error: e?.errors?.[0]?.message || e?.message || "Unable to audit this project." }) }
  });

  app.post("/api/disable-api", requireGoogle, proOnly("costguard"), async (req, res) => {
    const { projectId, service, confirm } = req.body || {};
    if (!PROJECT_RE.test(projectId || "") || !SVC_RE.test(service || "")) return res.status(400).json({ error: "INVALID_REQUEST", message: "Invalid project or service." });
    if (PROTECTED.has(service)) return res.status(400).json({ error: "PROTECTED_SERVICE", message: "Flipcloud won't disable this service because it would break project management." });
    if (confirm !== true) return res.status(400).json({ error: "CONFIRM_REQUIRED", message: "Confirm before disabling a service." });
    try {
      const su = google.serviceusage({ version: "v1", auth: req.googleAuth });
      // Without disableDependentServices Google refuses if something else relies on it, which is the safe default.
      const r = await su.services.disable({ name: `projects/${projectId}/services/${service}`, requestBody: { disableDependentServices: false } });
      res.json({ success: true, service, operation: r.data });
    } catch (e) { res.status(502).json({ error: e?.errors?.[0]?.message || e?.message || "Google refused to disable this service. Another service may depend on it." }) }
  });

  // ---- Exports ----
  app.get("/api/export/:projectId", requireGoogle, async (req, res) => {
    const projectId = req.params.projectId, format = String(req.query.format || "gcloud");
    if (!PROJECT_RE.test(projectId || "")) return res.status(400).json({ error: "INVALID_PROJECT", message: "That project ID is invalid." });
    if (!["gcloud", "terraform", "json", "markdown"].includes(format)) return res.status(400).json({ error: "INVALID_FORMAT", message: "Unknown export format." });
    if (format !== "gcloud") { const ent = await getEntitlement(req); if (!ent.pro) return res.status(402).json({ error: "PRO_REQUIRED", feature: "export", upgrade: true, trialAvailable: ent.trial.available, message: `${FEATURE_NAME.export} are Pro features.` }) }
    try {
      const services = (await listEnabled(req.googleAuth, projectId)).sort();
      let content, filename;
      if (format === "gcloud") {
        filename = `${projectId}-enable-apis.sh`;
        content = `#!/usr/bin/env bash\n# Generated by Flipcloud\ngcloud config set project ${projectId}\ngcloud services enable \\\n${services.map(s => "  " + s).join(" \\\n")}\n`;
      } else if (format === "terraform") {
        filename = `${projectId}-services.tf`;
        content = `# Generated by Flipcloud\n` + services.map(s => `resource "google_project_service" "${s.replace(/\.googleapis\.com$/, "").replace(/[^a-z0-9]/g, "_")}" {\n  project            = "${projectId}"\n  service            = "${s}"\n  disable_on_destroy = false\n}\n`).join("\n");
      } else if (format === "json") {
        filename = `${projectId}-services.json`;
        const a = analyze(services);
        content = JSON.stringify({ projectId, generatedAt: new Date().toISOString(), score: a.score, services: a.items.map(({ service, name, risk, note }) => ({ service, name, risk, note })) }, null, 2);
      } else {
        filename = `${projectId}-report.md`;
        const a = analyze(services);
        content = `# Google Cloud API report: ${projectId}\n\nGenerated ${new Date().toISOString().slice(0, 10)} by Flipcloud\n\n- Enabled services: **${a.items.length}**\n- Health score: **${a.score}/100**\n- Cost-risk services: **${a.flagged}** (${a.counts.high} high, ${a.counts.medium} medium)\n- Security-sensitive: **${a.counts.security}**\n\n## Findings\n\n| Service | Risk | Notes |\n|---|---|---|\n` +
          a.items.filter(i => i.risk !== "info").map(i => `| ${i.name} (\`${i.service}\`) | ${i.risk} | ${i.note} |`).join("\n") +
          `\n\n## All enabled services\n\n` + services.map(s => `- ${s}`).join("\n") + "\n";
      }
      res.json({ filename, format, content });
    } catch (e) { res.status(502).json({ error: e?.errors?.[0]?.message || e?.message || "Unable to export this project." }) }
  });

  return { getEntitlement };
}

// ---- Deep website scan (Pro) ----
const SEC_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"];
export function securityPreview(headers) {
  return { missing: SEC_HEADERS.filter(h => !headers.get(h)).length, total: SEC_HEADERS.length };
}
export function deepScan(headers, text) {
  const lower = text.toLowerCase();
  const security = Object.fromEntries(SEC_HEADERS.map(h => [h, Boolean(headers.get(h))]));
  const stack = {
    firebase: /firebase/.test(lower), googleAnalytics: /gtag\(|google-analytics|googletagmanager\.com\/gtag/.test(lower),
    tagManager: /googletagmanager\.com\/gtm/.test(lower), googleMaps: /maps\.googleapis\.com/.test(lower),
    recaptcha: /recaptcha/.test(lower), googleFonts: /fonts\.googleapis\.com/.test(lower), googleSignIn: /accounts\.google\.com\/gsi|google-signin/.test(lower)
  };
  const imgs = [...text.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const content = {
    lang: /<html[^>]+lang=/i.test(text), h1Count: (text.match(/<h1\b/gi) || []).length,
    imagesTotal: imgs.length, imagesMissingAlt: imgs.filter(t => !/\balt=/i.test(t)).length,
    mixedContent: /(src|href)=["']http:\/\//i.test(text), twitterCard: /name=["']twitter:card["']/i.test(text)
  };
  const tips = [];
  Object.entries(security).forEach(([h, ok]) => { if (!ok) tips.push(`Add the ${h} header.`) });
  if (!content.lang) tips.push("Set a lang attribute on <html>.");
  if (content.h1Count !== 1) tips.push(`Use exactly one <h1> (found ${content.h1Count}).`);
  if (content.imagesMissingAlt) tips.push(`${content.imagesMissingAlt} image(s) are missing alt text.`);
  if (content.mixedContent) tips.push("Replace http:// resources with https://.");
  return { security, stack, content, tips };
}
