const express = require('express');
const https   = require('https');
const path    = require('path');

const validateLicense = require('./api/validate-license');
const generateLicense  = require('./api/generate-license');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// License endpoints read raw body themselves (see api/ files) — mount before JSON parser
app.post('/api/validate-license', validateLicense);
app.post('/api/generate-license', generateLicense);

app.use(express.json({ limit: '1mb' }));

app.post('/api/generate', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured on server.' });

  // Accept either a single 'prompt' string (legacy) or a full 'messages' array (chat)
  let messages;
  if (Array.isArray(req.body.messages) && req.body.messages.length) {
    messages = req.body.messages;
  } else if (req.body.prompt) {
    messages = [{ role: 'user', content: req.body.prompt }];
  } else {
    return res.status(400).json({ error: 'Missing prompt or messages in request body.' });
  }

  const payload = JSON.stringify({
    model:      'claude-haiku-4-5',
    max_tokens: 2048,
    messages:   messages
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
        if (parsed.error) return res.status(apiRes.statusCode).json({ error: parsed.error.message || JSON.stringify(parsed.error) });
        return res.status(200).json(parsed);
      } catch(e) {
        return res.status(500).json({ error: 'Failed to parse Anthropic response' });
      }
    });
  });

  apiReq.on('error', (e) => res.status(500).json({ error: e.message }));
  apiReq.write(payload);
  apiReq.end();
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('Driftocity Estimate Pro running on port ' + PORT));
