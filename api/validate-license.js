// api/validate-license.js — Called by the app when a user enters their license key
const { getLicense, updateLicense } = require('./_license-store');

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
    try { parsed = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }

    const key = (parsed.key || '').trim().toUpperCase();
    const deviceId = (parsed.deviceId || '').trim();

    if (!key) return res.status(400).json({ valid: false, error: 'No license key provided' });

    try {
      const record = await getLicense(key);

      if (!record) {
        return res.status(200).json({ valid: false, error: 'License key not found. Check for typos or contact support.' });
      }

      if (record.revoked) {
        return res.status(200).json({ valid: false, error: 'This license has been deactivated. Contact support.' });
      }

      // First time this key is used — bind it to this device
      if (!record.device_id) {
        await updateLicense(key, {
          device_id: deviceId,
          activated_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        });
        return res.status(200).json({ valid: true, message: 'License activated!' });
      }

      // Key already bound to a device — check it matches
      if (record.device_id !== deviceId) {
        return res.status(200).json({
          valid: false,
          error: 'This license is already active on another device. Contact support to transfer it.'
        });
      }

      // Same device checking back in — update last_seen
      await updateLicense(key, { last_seen: new Date().toISOString() });
      return res.status(200).json({ valid: true, message: 'License verified.' });

    } catch (err) {
      console.error('validate-license error:', err.message);
      return res.status(500).json({ valid: false, error: 'Server error. Please try again.' });
    }
  });
};
