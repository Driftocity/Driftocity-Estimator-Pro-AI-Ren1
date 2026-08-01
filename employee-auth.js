import { kv, getAccountByCompanyCode } from './_lib/db.js';
import { signEmployeeToken } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { companyCode, pin } = req.body || {};
  if (!companyCode || !pin || !pin.trim()) {
    res.status(400).json({ error: 'A company code and PIN are required.' });
    return;
  }

  const account = await getAccountByCompanyCode(companyCode);
  if (!account) {
    res.status(404).json({ error: 'Unknown company link.' });
    return;
  }

  const employees = (await kv.get(`employees:${account.id}`)) || [];
  const employee = employees.find((e) => e.pin === pin.trim());
  if (!employee) {
    res.status(400).json({ error: 'That PIN is not recognized. Check with your boss.' });
    return;
  }

  const token = signEmployeeToken(account.id, employee.id, employee.name);
  res.status(200).json({
    token,
    employeeId: employee.id,
    employeeName: employee.name,
    privacyZone: employee.privacyZone || null
  });
}
