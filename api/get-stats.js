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

      // Use Supabase's count header instead of pulling all rows
      async function countEvents(eventType, sinceISO) {
        let url = SUPABASE_URL + '/rest/v1/events?event_type=eq.' + encodeURIComponent(eventType) + '&select=id';
        if (sinceISO) url += '&created_at=gte.' + encodeURIComponent(sinceISO);
        const r = await fetch(url, { headers: { ...headers, 'Prefer': 'count=exact' } });
        const range = r.headers.get('content-range'); // e.g. "0-9/42"
        if (range && range.includes('/')) {
          const total = range.split('/')[1];
          return total === '*' ? 0 : parseInt(total, 10);
        }
        const rows = await r.json();
        return Array.isArray(rows) ? rows.length : 0;
      }

      async function countDistinctDevices(eventType) {
        // Pull device_ids for this event type and count uniques client-side.
        // Fine at this scale; switch to a Postgres view/RPC if volume grows a lot.
        const url = SUPABASE_URL + '/rest/v1/events?event_type=eq.' + encodeURIComponent(eventType) + '&select=device_id';
        const r = await fetch(url, { headers });
        const rows = await r.json();
        if (!Array.isArray(rows)) return 0;
        const uniques = new Set(rows.map(r => r.device_id).filter(Boolean));
        return uniques.size;
      }

      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24*60*60*1000).toISOString();
      const weekAgo = new Date(now.getTime() - 7*24*60*60*1000).toISOString();

      const [
        opensAll, opens24h, opens7d,
        opensInstalledAll, opensBrowserAll,
        installsAll, installs7d,
        paywallAll, paywall24h, paywall7d,
        trialEstAll, paidEstAll,
        licenseActivatedAll,
        uniqueDevicesAll,
      ] = await Promise.all([
        // Total opens across both legacy + new event names, so old cached clients still count
        Promise.all([countEvents('app_open'), countEvents('app_open_browser'), countEvents('app_open_installed')])
          .then(([a,b,c]) => a+b+c),
        Promise.all([countEvents('app_open', dayAgo), countEvents('app_open_browser', dayAgo), countEvents('app_open_installed', dayAgo)])
          .then(([a,b,c]) => a+b+c),
        Promise.all([countEvents('app_open', weekAgo), countEvents('app_open_browser', weekAgo), countEvents('app_open_installed', weekAgo)])
          .then(([a,b,c]) => a+b+c),
        countEvents('app_open_installed'),
        countEvents('app_open_browser'),
        countEvents('pwa_installed'),
        countEvents('pwa_installed', weekAgo),
        countEvents('paywall_hit'),
        countEvents('paywall_hit', dayAgo),
        countEvents('paywall_hit', weekAgo),
        countEvents('estimate_created_trial'),
        countEvents('estimate_created_paid'),
        countEvents('license_activated'),
        countDistinctDevices('app_open_browser').then(async browserSet => {
          const installedSet = await countDistinctDevices('app_open_installed');
          return browserSet + installedSet; // rough unique-device estimate across both open types
        }),
      ]);

      // Licenses count too, since we're already here
      const licRes = await fetch(SUPABASE_URL + '/rest/v1/licenses?select=key', { headers: { ...headers, 'Prefer': 'count=exact' } });
      const licRange = licRes.headers.get('content-range');
      const totalLicenses = licRange && licRange.includes('/') ? parseInt(licRange.split('/')[1], 10) || 0 : 0;

      const activeRes = await fetch(SUPABASE_URL + '/rest/v1/licenses?device_id=not.is.null&select=key', { headers: { ...headers, 'Prefer': 'count=exact' } });
      const activeRange = activeRes.headers.get('content-range');
      const activatedLicenses = activeRange && activeRange.includes('/') ? parseInt(activeRange.split('/')[1], 10) || 0 : 0;

      const conversionRate = paywallAll > 0 ? Math.round((licenseActivatedAll / paywallAll) * 1000) / 10 : 0;

      return res.status(200).json({
        opens: { all: opensAll, last24h: opens24h, last7d: opens7d, installedApp: opensInstalledAll, browserOnly: opensBrowserAll },
        installs: { all: installsAll, last7d: installs7d },
        paywallHits: { all: paywallAll, last24h: paywall24h, last7d: paywall7d },
        trialUsage: { estimatesCreatedOnTrial: trialEstAll, estimatesCreatedPaid: paidEstAll },
        licenses: { total: totalLicenses, activated: activatedLicenses, activationEvents: licenseActivatedAll },
        conversionRatePct: conversionRate,
        uniqueDevicesApprox: uniqueDevicesAll,
      });

    } catch (err) {
      console.error('get-stats error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });
};
