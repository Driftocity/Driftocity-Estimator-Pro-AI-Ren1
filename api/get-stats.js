// api/get-stats.js — Admin-only endpoint returning usage counts
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

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || parsed.secret !== adminSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: 'Supabase not configured on server.' });
    }

    try {
      const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      };

      async function countEvents(eventType, sinceISO) {
        let url = SUPABASE_URL + '/rest/v1/events?event_type=eq.' + encodeURIComponent(eventType) + '&select=id';
        if (sinceISO) url += '&created_at=gte.' + encodeURIComponent(sinceISO);
        const r = await fetch(url, { headers: { ...headers, 'Prefer': 'count=exact' } });
        const range = r.headers.get('content-range');
        if (range && range.includes('/')) {
          const total = range.split('/')[1];
          return total === '*' ? 0 : parseInt(total, 10);
        }
        const rows = await r.json();
        return Array.isArray(rows) ? rows.length : 0;
      }

      // Pull ALL events at once — everything below is computed from this single dataset
      // so every number is guaranteed consistent with every other number.
      const allEventsRes = await fetch(
        SUPABASE_URL + '/rest/v1/events?select=event_type,device_id,created_at&order=created_at.asc',
        { headers }
      );
      const allEvents = await allEventsRes.json();
      const events = Array.isArray(allEvents) ? allEvents : [];

      const now = Date.now();
      const dayAgoMs = now - 24*60*60*1000;
      const weekAgoMs = now - 7*24*60*60*1000;

      const OPEN_TYPES = ['app_open', 'app_open_browser', 'app_open_installed'];

      function isOpen(e) { return OPEN_TYPES.includes(e.event_type); }
      function ts(e) { return new Date(e.created_at).getTime(); }

      // ── Unique devices — the real fix: union, not sum ──
      const allDeviceIds = new Set(events.map(e => e.device_id).filter(Boolean));
      const uniqueDevicesTotal = allDeviceIds.size;

      // Devices seen only via browser vs only via installed app vs both
      const browserDevices = new Set(events.filter(e => e.event_type === 'app_open_browser').map(e => e.device_id).filter(Boolean));
      const installedDevices = new Set(events.filter(e => e.event_type === 'app_open_installed').map(e => e.device_id).filter(Boolean));
      const bothDevices = [...browserDevices].filter(d => installedDevices.has(d));

      // ── Per-device activity summary — literally "who did what" ──
      const byDevice = {};
      events.forEach(e => {
        if (!e.device_id) return;
        if (!byDevice[e.device_id]) {
          byDevice[e.device_id] = {
            deviceId: e.device_id,
            firstSeen: e.created_at,
            lastSeen: e.created_at,
            opens: 0,
            estimatesTrial: 0,
            estimatesPaid: 0,
            paywallHits: 0,
            installed: false,
            licenseActivated: false,
          };
        }
        const d = byDevice[e.device_id];
        if (e.created_at < d.firstSeen) d.firstSeen = e.created_at;
        if (e.created_at > d.lastSeen) d.lastSeen = e.created_at;
        if (isOpen(e)) d.opens++;
        if (e.event_type === 'estimate_created_trial') d.estimatesTrial++;
        if (e.event_type === 'estimate_created_paid') d.estimatesPaid++;
        if (e.event_type === 'paywall_hit') d.paywallHits++;
        if (e.event_type === 'pwa_installed') d.installed = true;
        if (e.event_type === 'license_activated') d.licenseActivated = true;
      });
      const deviceList = Object.values(byDevice).sort((a,b) => new Date(b.lastSeen) - new Date(a.lastSeen));

      // ── Engaged vs bounced devices ──
      // "Engaged" = made at least 1 estimate. "Bounced" = opened but made 0 estimates ever.
      const engagedDevices = deviceList.filter(d => d.estimatesTrial + d.estimatesPaid > 0);
      const bouncedDevices = deviceList.filter(d => d.estimatesTrial + d.estimatesPaid === 0 && d.opens > 0);

      // ── Opens breakdown ──
      const opensAll = events.filter(isOpen).length;
      const opens24h = events.filter(e => isOpen(e) && ts(e) >= dayAgoMs).length;
      const opens7d  = events.filter(e => isOpen(e) && ts(e) >= weekAgoMs).length;
      const opensInstalledAll = events.filter(e => e.event_type === 'app_open_installed').length;
      const opensBrowserAll   = events.filter(e => e.event_type === 'app_open_browser').length;

      const installsAll = events.filter(e => e.event_type === 'pwa_installed').length;
      const installs7d  = events.filter(e => e.event_type === 'pwa_installed' && ts(e) >= weekAgoMs).length;

      const paywallAll = events.filter(e => e.event_type === 'paywall_hit').length;
      const paywall24h = events.filter(e => e.event_type === 'paywall_hit' && ts(e) >= dayAgoMs).length;
      const paywall7d  = events.filter(e => e.event_type === 'paywall_hit' && ts(e) >= weekAgoMs).length;

      const trialEstAll = events.filter(e => e.event_type === 'estimate_created_trial').length;
      const paidEstAll  = events.filter(e => e.event_type === 'estimate_created_paid').length;

      const licenseActivatedEvents = events.filter(e => e.event_type === 'license_activated').length;

      // ── Licenses table (source of truth for actual license state) ──
      const licRes = await fetch(SUPABASE_URL + '/rest/v1/licenses?select=key', { headers: { ...headers, 'Prefer': 'count=exact' } });
      const licRange = licRes.headers.get('content-range');
      const totalLicenses = licRange && licRange.includes('/') ? parseInt(licRange.split('/')[1], 10) || 0 : 0;

      const activeRes = await fetch(SUPABASE_URL + '/rest/v1/licenses?device_id=not.is.null&select=key', { headers: { ...headers, 'Prefer': 'count=exact' } });
      const activeRange = activeRes.headers.get('content-range');
      const activatedLicenses = activeRange && activeRange.includes('/') ? parseInt(activeRange.split('/')[1], 10) || 0 : 0;

      // Flag the mismatch you noticed, rather than hiding it
      const licenseTrackingMismatch = activatedLicenses !== licenseActivatedEvents;

      const conversionRate = paywallAll > 0 ? Math.round((licenseActivatedEvents / paywallAll) * 1000) / 10 : 0;
      const engagementRate = uniqueDevicesTotal > 0 ? Math.round((engagedDevices.length / uniqueDevicesTotal) * 1000) / 10 : 0;

      return res.status(200).json({
        // Headline "what's really going on" numbers
        uniqueDevices: {
          total: uniqueDevicesTotal,
          browserOnly: browserDevices.size - bothDevices.length,
          installedOnly: installedDevices.size - bothDevices.length,
          both: bothDevices.length,
        },
        engagement: {
          engagedDevices: engagedDevices.length,   // made >= 1 estimate
          bouncedDevices: bouncedDevices.length,    // opened, never made an estimate
          engagementRatePct: engagementRate,
        },
        opens: { all: opensAll, last24h: opens24h, last7d: opens7d, installedApp: opensInstalledAll, browserOnly: opensBrowserAll },
        installs: { all: installsAll, last7d: installs7d },
        paywallHits: { all: paywallAll, last24h: paywall24h, last7d: paywall7d },
        trialUsage: { estimatesCreatedOnTrial: trialEstAll, estimatesCreatedPaid: paidEstAll },
        licenses: {
          total: totalLicenses,
          activated: activatedLicenses,
          activationEvents: licenseActivatedEvents,
          mismatchWarning: licenseTrackingMismatch,
        },
        conversionRatePct: conversionRate,
        // Per-device breakdown — literally "who did what"
        devices: deviceList.slice(0, 50), // cap to most recent 50 to keep payload reasonable
      });

    } catch (err) {
      console.error('get-stats error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });
};
