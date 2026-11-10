# Project 2: Sing-it-in-my-key app

_Plan agreed 10 November 2026, from a grilling session._

## Who it's for

Rookie singers who **can't play an instrument**, starting with me.

## The problem

They want to sing songs in their own key, especially songs written for the opposite gender's voice, but they have no way to change the key themselves. People who play piano or guitar can work a song out in a new key; people who only sing can't.

Existing apps (Moises, Anytune, Chordify) are built for people who play instruments. Being made for singers is what has to set this app apart.

## What version 1 is

A **free, private test**, not a product launch yet. It's a web app for a computer browser, used by me and 5–8 singers who don't play instruments, to find out whether this actually helps.

### Version 1 features

- Upload your own audio file. No YouTube or Spotify links.
- **Key** slider in semitones, from −6 to +6.
- **Tempo** change.
- **Vocal volume** slider, from the original singer as a full guide down to fully removed.
- **Loop** a section, for practising a hard line.
- **Trim** the start and end.
- Download the edited backing track as an MP3.
- **1–5 star quality rating** with an optional comment after each song.

### Not in version 1

Recording yourself (first thing for version 2), individual instrument volumes, effects such as reverb, accounts, saved songs, YouTube or Spotify links, phone support, and payment.

## How it's built

| Part | How | Cost |
|---|---|---|
| Key change | A library in the browser, e.g. Signalsmith Stretch (**check its licence**) | Free |
| Tempo change | Built into the browser (`playbackRate`, which keeps pitch) | Free |
| Vocal removal | MusicGPT's 2-stem split (vocals and backing) | About 5¢ per song, pay-as-you-go |
| Hosting | A free hosting tier | Free |

- **No storage.** Split tracks live only in the open browser tab. Refreshing means re-uploading and paying again, so show a "you'll lose this if you leave" warning.
- **Safety:** one shared password for testers, the MusicGPT API key kept on the server (never in the browser), and **$10–20 of prepaid MusicGPT credit** as a hard spending cap (about 150–200 songs).
- **Who builds it:** me, with AI help (Claude Code). Start with a **rough throwaway prototype** of only the key slider and vocal removal, to prove it can be built.

## What to find out, in order

1. **Talk to the singers before they try it.** How do they handle songs in the wrong key today? Have they tried Moises or vocalremover.org, and why did or didn't they stick with them?
2. **Technical checks:**
   - Does MusicGPT's speed changer keep the pitch? The docs don't say. (The browser handles tempo anyway, so this only matters if I'd use MusicGPT for it.)
   - How does browser key-shifting sound on real songs, especially large shifts of ±5 semitones or more?
   - How clean is MusicGPT's vocal removal on the songs testers actually bring?
3. **Run the test for 2 weeks**, then talk to the singers again.

## Is it effective? (Decided in advance)

- **Leading:** each singer uses it unprompted on at least **2 songs within 2 weeks**.
- **Outcome:** at least **half** would be disappointed if it disappeared, and can **name a song they can now sing** that they couldn't before.
- **Quality:** average star rating, plus comments on audio problems. A high rating is an output, not the outcome: good ratings with nobody coming back means the app works but isn't needed.
- **Kill signal:** if most testers say "I'd just use Moises or vocalremover.org", stop and rethink before building more.

## Ideas for later

- Recording yourself singing over the track.
- **The app measures your vocal range and picks the best key automatically.** This is a strong way to stand out for singers who can't play an instrument.
- Saved songs and accounts, if testers hit the refresh problem often.
- Making your own music, the bigger goal.
- Pricing, decided from what testers say. For reference: vocalremover.org is free and Moises is about $6/month.
- Self-hosting the open-source Demucs model for vocal removal if usage ever gets large.

## Research notes (November 2026)

- **MusicGPT API** ([docs](https://docs.musicgpt.com/llms.txt)) offers vocal removal and stem splitting, a speed changer, key and BPM detection, denoise and more. It has **no key change for a whole song**. Requests are async (webhook or polling), with an 80 MB / 8-minute file limit. Paid plans have a free stem-split promotion in November 2026.
- **MusicGPT terms:** uploaders confirm they aren't infringing copyright, and uploads **may be used to train its AI**. Tell testers this.
- **Competitors:** Moises (stems, tempo, chords; about $6/month), LALAL.AI (stems only), vocalremover.org (free browser tools), Chordify (chords and transpose), Anytune (practice app). Most target instrument players.
- **Free alternatives:** Demucs, Ultimate Vocal Remover models and Spleeter for vocal removal (these need your own server); Signalsmith Stretch, SoundTouch and Rubber Band (GPL, so a paid licence for closed source) for key change.
