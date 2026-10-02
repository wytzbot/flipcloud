# Relaying Flutterwave webhooks from wyte.name.ng to Flipcloud

Flutterwave only allows one registered webhook URL per account. Since
wyte.name.ng already owns that slot, keep it there and have it forward
Flipcloud-relevant events on, byte-for-byte, so Flipcloud's existing
signature check (`FLW_SECRET_HASH` HMAC over the raw body) still works
unchanged — no code changes needed on Flipcloud's side, and no new secret
needs to be shared between the two apps.

## How Flipcloud transactions are tagged

Every Flipcloud-originated charge carries one of these markers, so
wyte.name.ng can tell which events are its own vs. Flipcloud's:

- `data.meta.product === "flipcloud"` (both v3 hosted checkout and the
  customer-creation call), or
- `data.tx_ref` starting with `"flipcloud-"` (v3 hosted checkout), or
- `data.tx_ref` / `data.reference` starting with `"FLIP-"` (v4 recurring
  charge)

## The critical rule: forward raw bytes, not re-serialized JSON

Flipcloud verifies the v4 signature with:

```js
crypto.createHmac("sha256", FLW_SECRET_HASH).update(req.rawBody).digest("base64")
```

This only matches if the bytes it receives are *identical* to what
Flutterwave originally sent. If wyte.name.ng parses the body into a JS
object and then re-stringifies it to forward, key ordering or whitespace
can change and the signature will fail to verify. Capture and forward the
original buffer instead.

## Example (Node/Express on wyte.name.ng)

```js
app.post("/flw-webhook", express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}), async (req, res) => {
  // ...wyte.name.ng's own existing webhook handling stays here...

  const data = req.body?.data || {};
  const meta = data.meta || {};
  const txRef = String(data.tx_ref || data.reference || "");
  const isFlipcloud =
    meta.product === "flipcloud" ||
    txRef.startsWith("flipcloud-") ||
    txRef.startsWith("FLIP-");

  if (isFlipcloud) {
    try {
      await fetch("https://YOUR-FLIPCLOUD-DOMAIN/flw-webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "flutterwave-signature": req.headers["flutterwave-signature"] || "",
          "verif-hash": req.headers["verif-hash"] || ""
        },
        body: req.rawBody // the untouched buffer — do NOT re-stringify req.body
      });
    } catch (e) {
      console.error("Failed to relay webhook to Flipcloud:", e.message);
      // Consider a retry queue here — Flutterwave only retries delivery
      // to wyte.name.ng, not to Flipcloud, since Flipcloud isn't the
      // registered webhook URL.
    }
  }

  res.status(200).json({ received: true }); // ack Flutterwave regardless
});
```

Replace `YOUR-FLIPCLOUD-DOMAIN` with Flipcloud's actual deployed domain.

## If wyte.name.ng isn't Node/Express

The same idea applies in any stack: capture the exact request body as
bytes (not a parsed-then-reserialized object), and forward those bytes
plus the two original headers unchanged. Most HTTP frameworks expose the
raw body before/instead of their JSON parser — look for that rather than
`json.dumps(request.json)` or equivalent, which will break the signature.

## If you can't get raw bytes on wyte.name.ng's stack

If the framework genuinely won't give you the raw body, ask about the
fallback instead: add a second, relay-specific verification path to
Flipcloud's `/flw-webhook` (a new secret shared only between wyte.name.ng
and Flipcloud, unrelated to Flutterwave's own signature). That requires a
small `server.js` change and hasn't been made yet — only implement it if
this byte-relay approach isn't workable.

## Nothing changes in Flipcloud's own environment variables for this

`FLW_SECRET_HASH` and `FLW_ALLOW_V3_WEBHOOK` stay exactly as already
configured on Flipcloud (see the main env var list) — both apps share the
same Flutterwave account, so they share the same webhook secret already.
