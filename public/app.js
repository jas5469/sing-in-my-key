// Sing In My Key: browser side.
// Two Signalsmith Stretch players (vocals and backing) run in lockstep with the
// same position, key and tempo, so the vocal volume can change while playing.

import SignalsmithStretch from './vendor/SignalsmithStretch.mjs';
import { Mp3Encoder } from './vendor/lamejs/lamejs.js';

const $ = (id) => document.getElementById(id);
const ui = {
  demoNotice: $('demo-notice'), fileInput: $('file-input'), status: $('status'),
  playerCard: $('player-card'), songName: $('song-name'),
  play: $('play-button'), seek: $('seek'), timeNow: $('time-now'), timeTotal: $('time-total'),
  key: $('key'), keyValue: $('key-value'),
  tempo: $('tempo'), tempoValue: $('tempo-value'),
  vocals: $('vocals'), vocalsValue: $('vocals-value'), vocalControl: $('vocal-control'),
  reset: $('reset'),
  downloadCard: $('download-card'), download: $('download'), downloadStatus: $('download-status'),
};

const LEAD = 0.05; // seconds ahead to schedule changes, so both players switch together

let demoMode = null; // unknown until /api/config answers
let ctx = null;
let tracks = [];     // [{ name, node, gain, buffer }]
let songName = '';
let duration = 0;
let playing = false;
let position = 0;    // seconds into the song, while paused
let seeking = false;
let songLoaded = false;
let loadId = 0;      // bumps per song, so updates from an old song's players are ignored
let lastTick = { input: 0, at: 0 }; // last reported position and the audio clock time it arrived

const settings = () => ({
  semitones: Number(ui.key.value),
  rate: Number(ui.tempo.value) / 100,
});

// ---------- Start-up ----------
async function loadConfig() {
  const cfg = await fetchJson('api/config');
  demoMode = cfg.demoMode;
  // The GitHub Pages build ships a static config with publicDemo: true (there's no server there).
  if (cfg.publicDemo) {
    ui.demoNotice.textContent =
      'Public demo: change the key and tempo of your own songs and download the result. ' +
      'Everything happens in your browser; your song is never uploaded. ' +
      'Vocal removal is switched off in this demo.';
  }
  ui.demoNotice.hidden = !demoMode;
}
loadConfig().catch(() => setStatus("Couldn't reach the server. Reload the page to try again.", true));

window.addEventListener('beforeunload', (e) => {
  if (songLoaded) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- Upload and separation ----------
ui.fileInput.addEventListener('change', async () => {
  const file = ui.fileInput.files[0];
  if (!file) return;
  ui.fileInput.disabled = true;
  try {
    if (demoMode === null) await loadConfig(); // the first attempt failed; try again
    let stems;
    if (demoMode) {
      setStatus('Loading song…');
      stems = { full: await file.arrayBuffer() };
    } else {
      stems = await separateVocals(file); // the current song keeps playing meanwhile
    }
    setStatus('Preparing player…');
    await unloadSong();
    await loadSong(stems);
    songName = file.name;
    ui.songName.textContent = file.name;
    ui.playerCard.hidden = false;
    ui.downloadCard.hidden = false;
    setDownloadStatus('');
    setStatus(demoMode ? 'Ready.' : 'Ready. The vocals are separated.');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Something went wrong.', true);
    if (!tracks.length) ui.playerCard.hidden = ui.downloadCard.hidden = true; // don't leave dead controls on screen
  } finally {
    ui.fileInput.disabled = false;
    ui.fileInput.value = '';
  }
});

async function separateVocals(file) {
  setStatus('Uploading…');
  const form = new FormData();
  form.append('song', file);
  const start = await fetchJson('api/separate', { method: 'POST', body: form });

  // The job is already paid for, so ride out brief hiccups instead of giving up on one bad check.
  const began = Date.now();
  let failedChecks = 0;
  for (;;) {
    const secs = Math.round((Date.now() - began) / 1000);
    setStatus(`Separating the vocals from the music… ${secs}s (this usually takes about a minute)`);
    await sleep(4000);
    if (Date.now() - began > 10 * 60 * 1000) throw new Error('Separation is taking too long. Try again later.');
    let result;
    try {
      result = await fetchJson(`api/status/${encodeURIComponent(start.taskId)}`);
      failedChecks = 0;
    } catch (err) {
      if (++failedChecks >= 5) throw err;
      continue;
    }
    if (result.status === 'COMPLETED') {
      setStatus('Downloading the separated tracks…');
      const [vocals, instrumental] = await Promise.all([
        fetch(result.vocals).then((r) => r.arrayBuffer()),
        fetch(result.instrumental).then((r) => r.arrayBuffer()),
      ]);
      return { vocals, instrumental };
    }
    if (result.status === 'FAILED') throw new Error(result.message || 'Separation failed.');
  }
}

// ---------- Player ----------
async function loadSong(stems) {
  ctx ??= new AudioContext();
  const entries = Object.entries(stems);
  const decoded = await Promise.all(entries.map(([, data]) => ctx.decodeAudioData(data)));

  duration = Math.max(...decoded.map((b) => b.duration));
  tracks = [];
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i][0];
    const buffer = decoded[i];
    const node = await SignalsmithStretch(ctx);
    const gain = ctx.createGain();
    node.connect(gain).connect(ctx.destination);
    await node.addBuffers(stereoChannels(buffer));
    tracks.push({ name, node, gain, buffer });
  }

  // Vocals keep their natural voice character when the key moves.
  const vocalTrack = track('vocals');
  vocalTrack?.node.schedule({ formantCompensation: true });

  // Progress updates come from one player; the other follows the same schedule.
  const id = ++loadId;
  tracks[0].node.setUpdateInterval(0.1, (t) => { if (id === loadId) onTick(t); });

  ui.vocalControl.classList.toggle('disabled', !vocalTrack);
  ui.vocals.disabled = !vocalTrack;
  ui.vocalsValue.textContent = vocalTrack ? `${ui.vocals.value}%` : 'n/a in demo';
  applyVocalVolume();

  position = 0;
  lastTick = { input: 0, at: ctx.currentTime };
  ui.seek.max = duration;
  ui.timeTotal.textContent = fmt(duration);
  updateTime(0);
  songLoaded = true;
}

async function unloadSong() {
  if (!tracks.length) return;
  pause();
  loadId++; // ignore any late position updates from these players
  for (const t of tracks) {
    t.node.stop();
    t.node.dropBuffers(); // release the song audio held by the player
    t.node.disconnect();
    t.gain.disconnect();
  }
  tracks = [];
  songLoaded = false;
}

const track = (name) => tracks.find((t) => t.name === name);

function scheduleAll(change) {
  const output = ctx.currentTime + LEAD;
  for (const t of tracks) t.node.schedule({ output, ...change });
}

async function play() {
  if (!tracks.length) return;
  await ctx.resume();
  if (position >= duration - 0.05) position = 0;
  lastTick = { input: position, at: ctx.currentTime + LEAD };
  scheduleAll({ active: true, input: position, ...settings() });
  playing = true;
  ui.play.textContent = '❚❚';
  ui.play.setAttribute('aria-label', 'Pause');
}

function pause() {
  if (!tracks.length) return;
  if (playing) position = currentPosition();
  scheduleAll({ active: false });
  playing = false;
  ui.play.textContent = '▶';
  ui.play.setAttribute('aria-label', 'Play');
}

// Updates arrive every 0.1s, so add the time since the last one for an exact position.
function currentPosition() {
  const elapsed = Math.max(0, ctx.currentTime - lastTick.at);
  return Math.min(duration, lastTick.input + elapsed * settings().rate);
}

function onTick(inputTime) {
  lastTick = { input: inputTime, at: ctx.currentTime };
  if (!playing) return;
  if (inputTime >= duration) {
    pause();
    position = duration;
    updateTime(duration);
    return;
  }
  if (!seeking) updateTime(inputTime);
}

function updateTime(t) {
  ui.seek.value = t;
  ui.timeNow.textContent = fmt(t);
}

function applyVocalVolume() {
  const v = track('vocals');
  if (v) v.gain.gain.setTargetAtTime(Number(ui.vocals.value) / 100, ctx.currentTime, 0.03);
}

// ---------- Download ----------
// Re-render the whole song faster than real time with the current settings,
// using the same Stretch engine as playback, then encode it to MP3.

async function renderEdited() {
  const { semitones, rate } = settings();
  const sampleRate = tracks[0].buffer.sampleRate;
  const offline = new OfflineAudioContext(2, Math.ceil((duration / rate) * sampleRate), sampleRate);
  for (const t of tracks) {
    const volume = t.name === 'vocals' ? Number(ui.vocals.value) / 100 : 1;
    if (volume === 0) continue; // vocals fully removed: skip the work
    const node = await SignalsmithStretch(offline);
    const gain = offline.createGain();
    gain.gain.value = volume;
    node.connect(gain).connect(offline.destination);
    await node.addBuffers(stereoChannels(t.buffer));
    node.schedule({ output: 0, active: true, input: 0, rate, semitones, formantCompensation: t.name === 'vocals' });
  }
  return offline.startRendering();
}

async function encodeMp3(audio, onProgress) {
  const encoder = new Mp3Encoder(2, audio.sampleRate, 192);
  const [left, right] = [audio.getChannelData(0), audio.getChannelData(1)];
  const BLOCK = 1152; // samples per MP3 frame
  const chunks = [];
  const toInt16 = (f32) => {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i])); // clip instead of wrapping around
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  for (let i = 0; i < left.length; i += BLOCK) {
    const mp3 = encoder.encodeBuffer(toInt16(left.subarray(i, i + BLOCK)), toInt16(right.subarray(i, i + BLOCK)));
    if (mp3.length) chunks.push(mp3);
    if (i % (BLOCK * 200) === 0) { // let the page breathe and show progress
      onProgress(i / left.length);
      await sleep(0);
    }
  }
  chunks.push(encoder.flush());
  return new Blob(chunks, { type: 'audio/mpeg' });
}

// e.g. "My Song (key +2, tempo 90%, no vocals).mp3"
function downloadName() {
  const base = songName.replace(/\.[^.]+$/, '') || 'song';
  const { semitones, rate } = settings();
  const edits = [];
  if (semitones) edits.push(`key ${semitones > 0 ? '+' : '−'}${Math.abs(semitones)}`);
  if (rate !== 1) edits.push(`tempo ${Math.round(rate * 100)}%`);
  if (track('vocals')) {
    const v = Number(ui.vocals.value);
    if (v === 0) edits.push('no vocals');
    else if (v < 100) edits.push(`vocals ${v}%`);
  }
  const name = edits.length ? `${base} (${edits.join(', ')})` : base;
  return `${name.replace(/[\\/:*?"<>|]/g, '_')}.mp3`;
}

ui.download.addEventListener('click', async () => {
  if (!tracks.length) return;
  ui.download.disabled = true;
  try {
    setDownloadStatus('Applying your edits…');
    const audio = await renderEdited();
    const blob = await encodeMp3(audio, (p) => setDownloadStatus(`Making the MP3… ${Math.round(p * 100)}%`));
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: downloadName() });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setDownloadStatus(`Downloaded “${link.download}” (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
  } catch (err) {
    console.error(err);
    setDownloadStatus(`Couldn't make the download: ${err.message || err}`, true);
  } finally {
    ui.download.disabled = false;
  }
});

// ---------- Controls ----------
ui.play.addEventListener('click', () => (playing ? pause() : play()));

ui.seek.addEventListener('input', () => { seeking = true; ui.timeNow.textContent = fmt(Number(ui.seek.value)); });
ui.seek.addEventListener('change', () => {
  seeking = false;
  position = Number(ui.seek.value);
  lastTick = { input: position, at: ctx.currentTime + LEAD };
  if (playing) scheduleAll({ input: position });
});

ui.key.addEventListener('input', () => {
  const s = Number(ui.key.value);
  ui.keyValue.textContent = s === 0 ? 'Original key' : `${s > 0 ? '+' : '−'}${Math.abs(s)} semitone${Math.abs(s) === 1 ? '' : 's'}`;
  if (tracks.length) scheduleAll({ semitones: s });
});

ui.tempo.addEventListener('input', () => {
  ui.tempoValue.textContent = `${ui.tempo.value}%`;
  if (tracks.length) scheduleAll({ rate: Number(ui.tempo.value) / 100 });
});

ui.vocals.addEventListener('input', () => {
  ui.vocalsValue.textContent = `${ui.vocals.value}%`;
  applyVocalVolume();
});

ui.reset.addEventListener('click', () => {
  ui.key.value = 0; ui.tempo.value = 100; ui.vocals.value = 100;
  for (const el of [ui.key, ui.tempo, ui.vocals]) el.dispatchEvent(new Event('input'));
});

// Space plays/pauses, except where Space already does something: on a focused button
// it presses that button (Play included), and sliders/file inputs handle it themselves.
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && tracks.length && !['INPUT', 'BUTTON'].includes(e.target.tagName)) {
    e.preventDefault();
    playing ? pause() : play();
  }
});

// ---------- Helpers ----------
function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle('error', isError);
}

function setDownloadStatus(msg, isError = false) {
  ui.downloadStatus.textContent = msg;
  ui.downloadStatus.classList.toggle('error', isError);
}

// Stretch players take exactly two channels; mono files play on both sides.
const stereoChannels = (buffer) =>
  [buffer.getChannelData(0), buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)];

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
