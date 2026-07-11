const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Serve all static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ── AI endpoint ──────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server.' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const payload = JSON.stringify({
    model:      'claude-haiku-4-5',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: prompt }]
  });

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers:  {
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(payload),
      'x-api-key':         key,
      'anthropic-version': '2023-06-01'
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        res.status(apiRes.statusCode).json(parsed);
      } catch(e) {
        res.status(500).json({ error: 'Failed to parse Anthropic response' });
      }
    });
  });

  apiReq.on('error', (e) => {
    console.error('Anthropic request error:', e.message);
    res.status(500).json({ error: e.message });
  });

  apiReq.write(payload);
  apiReq.end();
});

// ── Catch-all: serve index.html for any other route ─────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Driftocity Estimate Pro running on port ${PORT}`);
});
