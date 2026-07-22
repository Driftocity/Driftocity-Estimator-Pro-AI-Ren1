// api/log-event.js — Lightweight event logging (app opens, paywall hits)
// No auth required since this is just anonymous usage counting, not sensitive data.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch (e) { parsed = {}; }

    const eventType = (parsed.eventType || '').trim();
    const deviceId = (parsed.deviceId || '').trim();

    const allowed = [
      'app_open',            // legacy, kept for backward compat with old cached clients
      'app_open_browser',    // opened via a regular browser tab
      'app_open_installed',  // opened as an installed PWA (standalone mode)
      'paywall_hit',         // hit the 3-estimate trial wall
      'pwa_installed',       // actually completed the "Add to Home Screen" install
      'estimate_created_trial', // saved a new estimate while still on the free trial
      'estimate_created_paid',  // saved a new estimate as a paying/licensed user
      'license_activated',   // successfully activated a paid license key
    ];
    if (!allowed.includes(eventType)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      // Fail silently — analytics should never break the app itself
      return res.status(200).json({ ok: false });
    }

    try {
      await fetch(SUPABASE_URL + '/rest/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
        },
        body: JSON.stringify([{ event_type: eventType, device_id: deviceId || null }]),
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('log-event error:', err.message);
      // Still return 200 — analytics failures should never surface to the user
      return res.status(200).json({ ok: false });
    }
  });
};
