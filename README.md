# Sing In My Key

A prototype web app for singers who can't play an instrument. Upload a song, move it into your key, and turn the original singer down so you can sing over it.

**Try the public demo:** https://jas5469.github.io/sing-in-my-key/
(Key, tempo and MP3 download work on your own songs, right in your browser. Your song is never uploaded. Vocal removal is switched off in the public demo.)

See [PLAN.md](PLAN.md) for who it's for, why, and how the test will be judged.

## What it does now

- **Key:** −6 to +6 semitones, changed live while the song plays.
- **Tempo:** 50% to 150%, without changing the key.
- **Original singer:** a volume slider from full guide down to fully removed.
- **Download MP3:** saves the song with your key, tempo and vocal settings applied (192 kbps), named after the edits, e.g. `My Song (key +2, no vocals).mp3`.

Key and tempo changes run in the browser with [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) (MIT licence), so they're free. Vocal separation uses the [MusicGPT API](https://docs.musicgpt.com/) (`2_stems` extraction), paid per song.

Nothing is stored: the song only lives in the open browser tab.

## Run it on your computer

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
cp .env.example .env
npm start
```

Then open http://localhost:3000.

With no `MUSICGPT_API_KEY` in `.env`, the app runs in **demo mode**: key and tempo work on the whole song, but the vocals can't be separated. Add your key to turn on vocal separation.

## Settings (`.env`)

| Setting | What it's for |
|---|---|
| `MUSICGPT_API_KEY` | Your MusicGPT key. Stays on the server, never sent to the browser. |
| `APP_PASSWORD` | Shared password for testers (the browser asks for it; any username works). **Set this before putting it online.** |
| `PORT` | Defaults to 3000. |

Use MusicGPT **pay-as-you-go prepaid credits** so the bill can't go over what you've loaded.

## Public demo (GitHub Pages)

GitHub Pages can't run `server.js`, so the public demo is a static build:

- `npm run build:pages` copies `public/` and the two browser libraries into `_site/`, plus a stand-in `api/config` that switches on public demo mode. Vocal removal is off there, so no API key is ever exposed and nobody can spend your MusicGPT credits.
- [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs that build and publishes it every time `main` changes.
- **One-time setup:** the repo must be public (or on a paid plan), and **Settings → Pages → Source** must be set to **GitHub Actions**.

The password-protected tester version with vocal removal runs `server.js` on a Node host instead.

## Not built yet

Loop a section, trim, star rating, and online hosting. See the version 1 list in [PLAN.md](PLAN.md).
