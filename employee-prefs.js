import { kv } from './_lib/db.js';
import { requireEmployeeAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = requireEmployeeAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Employee login required.' });
    return;
  }

  const { privacyZone } = req.body || {};
  if (privacyZone !== null && typeof privacyZone !== 'object') {
    res.status(400).json({ error: 'privacyZone must be an object with lat/lng/radius, or null to clear it.' });
    return;
  }
  if (privacyZone && (typeof privacyZone.lat !== 'number' || typeof privacyZone.lng !== 'number' || typeof privacyZone.radius !== 'number')) {
    res.status(400).json({ error: 'privacyZone needs lat, lng, and radius.' });
    return;
  }

  const key = `employees:${auth.accountId}`;
  const employees = (await kv.get(key)) || [];
  const employee = employees.find((e) => e.id === auth.employeeId);
  if (!employee) {
    res.status(404).json({ error: 'Employee not found.' });
    return;
  }

  employee.privacyZone = privacyZone;
  await kv.set(key, employees);
  res.status(200).json({ ok: true, privacyZone: employee.privacyZone });
}
