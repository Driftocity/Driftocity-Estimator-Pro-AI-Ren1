// api/generate-license.js — Admin-only endpoint to create new license keys
// Call this yourself (via the admin.html page) after someone pays on Stripe
// Protected by ADMIN_SECRET environment variable

const { generateKey, getLicense, createLicense } = require('./_license-store');

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
    if (!adminSecret) {
      return res.status(500).json({ error: 'ADMIN_SECRET not configured on server.' });
    }
    if (parsed.secret !== adminSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Generate a unique key (retry if collision, though astronomically unlikely)
      let key, existing;
      do {
        key = generateKey();
        existing = await getLicense(key);
      } while (existing);

      await createLicense({
        key: key,
        customer_email: parsed.email || '',
        customer_name: parsed.name || '',
        device_id: null,
        activated_at: null,
        last_seen: null,
        revoked: false,
      });

      return res.status(200).json({ success: true, key: key });

    } catch (err) {
      console.error('generate-license error:', err.message);
      return res.status(500).json({ error: 'Server error: ' + err.message });
    }
  });
};
