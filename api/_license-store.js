// api/_license-store.js — License storage backed by Supabase (persistent, survives redeploys)
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function supabaseHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
  };
}

function checkConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set on server.');
  }
}

// Generate a human-friendly license key like DRFT-XXXX-XXXX-XXXX
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars (0,O,1,I)
  function block() {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(chars.length)];
    return s;
  }
  return `DRFT-${block()}-${block()}-${block()}`;
}

// Fetch a single license row by key. Returns null if not found.
async function getLicense(key) {
  checkConfig();
  const url = SUPABASE_URL + '/rest/v1/licenses?key=eq.' + encodeURIComponent(key) + '&select=*';
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error('Supabase read error: ' + res.status);
  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

// Insert a new license row.
async function createLicense(record) {
  checkConfig();
  const url = SUPABASE_URL + '/rest/v1/licenses';
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
    body: JSON.stringify([record]),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Supabase insert error: ' + res.status + ' ' + body);
  }
  const rows = await res.json();
  return rows[0];
}

// Update an existing license row by key.
async function updateLicense(key, fields) {
  checkConfig();
  const url = SUPABASE_URL + '/rest/v1/licenses?key=eq.' + encodeURIComponent(key);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: Object.assign({}, supabaseHeaders(), { 'Prefer': 'return=representation' }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Supabase update error: ' + res.status + ' ' + body);
  }
  const rows = await res.json();
  return rows[0];
}

module.exports = {
  generateKey,
  getLicense,
  createLicense,
  updateLicense,
};
