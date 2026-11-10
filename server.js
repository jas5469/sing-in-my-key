// Sing In My Key: prototype server.
// Jobs: password-protect the app, keep the MusicGPT API key off the browser,
// send uploads to MusicGPT for vocal separation, and relay the results.

import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.MUSICGPT_API_KEY || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const MUSICGPT = 'https://api.musicgpt.com/api/public';

// Without an API key the app runs in "demo mode": no vocal separation,
// but the key and tempo controls still work on the uploaded file.
const DEMO_MODE = !API_KEY;

const app = express();

// --- Shared password (browser login box; any username works) -------------
// Compare hashes in constant time, so response timing can't leak the password.
const sha256 = (s) => createHash('sha256').update(s).digest();
const PASSWORD_HASH = sha256(APP_PASSWORD);

app.use((req, res, next) => {
  if (!APP_PASSWORD) return next();
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const password = decoded.slice(decoded.indexOf(':') + 1);
    if (timingSafeEqual(sha256(password), PASSWORD_HASH)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Sing In My Key", charset="UTF-8"');
  res.status(401).send('Password required.');
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules/signalsmith-stretch')));
app.use('/vendor/lamejs', express.static(path.join(__dirname, 'node_modules/@breezystack/lamejs/dist')));

app.get('/api/config', (req, res) => {
  res.json({ demoMode: DEMO_MODE });
});

// --- 1. Upload a song and start vocal separation ---------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 }, // MusicGPT's limit is 80 MB
});

app.post('/api/separate', upload.single('song'), async (req, res) => {
  if (DEMO_MODE) return res.status(400).json({ error: 'Demo mode: no MusicGPT API key set.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const form = new FormData();
  form.append('audio_file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  form.append('stem_preset', '2_stems'); // vocals + instrumental

  try {
    const r = await fetch(`${MUSICGPT}/v2/Extraction`, {
      method: 'POST',
      headers: { Authorization: API_KEY },
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.success) {
      console.error('MusicGPT extraction error:', r.status, data);
      return res.status(502).json({ error: data.message || `MusicGPT error ${r.status}` });
    }
    console.log(`Extraction started: task ${data.task_id}, eta ${data.eta}, credits ~${data.credit_estimate}`);
    res.json({ taskId: data.task_id, eta: data.eta });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not reach MusicGPT.' });
  }
});

// --- 2. Poll for the result --------------------------------------------------
app.get('/api/status/:taskId', async (req, res) => {
  if (DEMO_MODE) return res.status(400).json({ error: 'Demo mode.' });
  const url = `${MUSICGPT}/v1/byId?conversionType=EXTRACTION&task_id=${encodeURIComponent(req.params.taskId)}`;
  try {
    const r = await fetch(url, { headers: { Authorization: API_KEY } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data.message || `MusicGPT error ${r.status}` });

    const conv = data.conversion || {};
    const status = String(conv.status || 'UNKNOWN').toUpperCase();
    if (/FAIL|ERROR/.test(status)) return res.json({ status: 'FAILED', message: conv.message });
    if (status !== 'COMPLETED') return res.json({ status });

    const stems = findStemUrls(conv);
    if (!stems.vocals || !stems.instrumental) {
      // The docs don't show a finished extraction's exact shape, so log it to fix the parser.
      console.error('Completed, but could not find stem URLs in:', JSON.stringify(conv, null, 2));
      return res.json({ status: 'FAILED', message: 'Finished, but the stem links were not where expected. See server log.' });
    }
    res.json({
      status: 'COMPLETED',
      vocals: `/api/audio?u=${encodeURIComponent(stems.vocals)}`,
      instrumental: `/api/audio?u=${encodeURIComponent(stems.instrumental)}`,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not reach MusicGPT.' });
  }
});

// The webhook docs put stems in a JSON string like {"vocals": url, "instrumental": url}.
// Search every field for that, and fall back to URLs whose names end in _vocals / _instrumental.
function findStemUrls(conv) {
  const found = {};
  for (const value of Object.values(conv)) {
    let obj = value;
    if (typeof value === 'string' && value.trim().startsWith('{')) {
      try { obj = JSON.parse(value); } catch { continue; }
    }
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string' || !v.startsWith('http')) continue;
        if (/^vocals?$/i.test(k) && !found.vocals) found.vocals = v;
        if (/^instrumental$/i.test(k) && !found.instrumental) found.instrumental = v;
      }
    } else if (typeof value === 'string' && value.startsWith('http')) {
      // Match the file name only, so signed links with ?token=… still count.
      let file;
      try { file = new URL(value).pathname; } catch { continue; }
      if (/_vocals?\.\w+$/i.test(file) && !found.vocals) found.vocals = value;
      if (/_instrumental\.\w+$/i.test(file) && !found.instrumental) found.instrumental = value;
    }
  }
  return found;
}

// --- 3. Relay the stem audio (avoids browser cross-site blocks) ------------
// Only MusicGPT's own servers are allowed, so this can't be used as an open proxy.
// Redirects are followed by hand so every hop is checked, not just the first.
const isMusicGptUrl = (url) =>
  url.protocol === 'https:' && (url.hostname === 'musicgpt.com' || url.hostname.endsWith('.musicgpt.com'));

app.get('/api/audio', async (req, res) => {
  let target;
  try { target = new URL(String(req.query.u)); } catch { return res.status(400).end(); }

  let r;
  for (let hops = 0; ; hops++) {
    if (!isMusicGptUrl(target)) return res.status(400).json({ error: 'Not a MusicGPT link.' });
    r = await fetch(target, { redirect: 'manual' });
    const location = r.headers.get('location');
    if (r.status < 300 || r.status >= 400 || !location) break;
    if (hops >= 3) return res.status(502).json({ error: 'Too many redirects.' });
    target = new URL(location, target);
  }
  if (!r.ok || !r.body) return res.status(502).end();

  res.set('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
  const length = r.headers.get('content-length');
  if (length) res.set('Content-Length', length);
  // Stream it through instead of holding the whole file in memory.
  await pipeline(Readable.fromWeb(r.body), res);
});

app.use((err, req, res, next) => {
  if (res.headersSent) { console.error(err); return res.destroy(); } // e.g. a stream broke mid-relay
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is over 80 MB.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => {
  console.log(`Sing In My Key running at http://localhost:${PORT}`);
  if (DEMO_MODE) console.log('Demo mode: set MUSICGPT_API_KEY in .env to turn on vocal separation.');
  if (!APP_PASSWORD) console.log('Warning: no APP_PASSWORD set, so anyone with the link can use it.');
});
