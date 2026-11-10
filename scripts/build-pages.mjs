// Builds the public demo for GitHub Pages into _site/.
// Pages can't run server.js, so the demo runs in "public demo" mode:
// key, tempo and MP3 download work in the browser; vocal removal is off.
//
// Usage: npm run build:pages

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '_site');
const from = (...p) => path.join(root, ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(from('public'), out, { recursive: true });

// The same libraries server.js serves from node_modules at /vendor.
fs.mkdirSync(path.join(out, 'vendor', 'lamejs'), { recursive: true });
fs.copyFileSync(from('node_modules/signalsmith-stretch/SignalsmithStretch.mjs'), path.join(out, 'vendor/SignalsmithStretch.mjs'));
fs.copyFileSync(from('node_modules/@breezystack/lamejs/dist/lamejs.js'), path.join(out, 'vendor/lamejs/lamejs.js'));

// Stand-in for the server's /api/config: tells the page it's the public demo.
fs.mkdirSync(path.join(out, 'api'), { recursive: true });
fs.writeFileSync(path.join(out, 'api/config'), JSON.stringify({ demoMode: true, publicDemo: true }));

// Serve files as-is (no Jekyll processing).
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Built the public demo in ${path.relative(root, out)}/`);
