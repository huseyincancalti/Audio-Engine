# Audio Engine

**Your browser's audio, under your control.**

Boost volume beyond 100%, shape sound with a 5-band EQ, tame loud ads with a compressor — and do it automatically, per site, without touching a slider twice.

[![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://github.com/huseyincancalti/Audio-Engine/releases)
[![Firefox](https://img.shields.io/badge/Firefox-MV2-FF7139?logo=firefox&logoColor=white)](https://github.com/huseyincancalti/Audio-Engine/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## What it does

Audio Engine sits quietly in your browser. Set a rule once — `*.youtube.com → 150%` — and it applies every time you visit. No popup required. No babysitting.

- **Volume 0–1000%** with smooth ramping (no pops, no clipping)
- **5-band EQ** — 60 Hz · 250 Hz · 1 kHz · 4 kHz · 12 kHz, ±12 dB each
- **Dynamic Range Compression** — loud ads quieter, quiet dialogue louder
- **Mono mix** — fold stereo to mono with one toggle
- **Rule engine** — domain-based rules, exact match > subdomain > wildcard, auto-applied
- **Auto-wake** — rules fire when you open a tab, no popup needed
- **Live VU meter** — pulsing badge and level bar in the popup while audio plays

---

## Browser Support

| Browser | Version | Status |
|---|---|---|
| Chrome | 116+ | Full — `tabCapture` + offscreen, works on every site including Netflix, TikTok |
| Edge / Brave | 116+ | Full — same as Chrome |
| Firefox | 140+ | Full on most sites — Web Audio engine, DRM content plays normally without boost |
| LibreWolf | 140+ | Full — same as Firefox, see install note below |

---

## Install

### Chrome, Edge, Brave

> A Chrome Web Store listing is coming. Until then, load it as an unpacked extension.

1. Go to the [Releases page](https://github.com/huseyincancalti/Audio-Engine/releases) and download **`audio-engine-chrome.zip`**
2. Unzip the file anywhere
3. Open `chrome://extensions` → enable **Developer mode** (toggle, top right)
4. Click **Load unpacked** → select the unzipped folder
5. Pin the extension icon to your toolbar

Done. The extension survives browser restarts.

---

### Firefox

> A Firefox Add-ons (AMO) listing is coming. Until then, install the `.xpi` directly.

1. Go to the [Releases page](https://github.com/huseyincancalti/Audio-Engine/releases) and download **`audio-engine-firefox.xpi`**
2. Open `about:addons` → click the **⚙️ gear icon** → **Install Add-on From File**
3. Select the `.xpi` → confirm the install

The extension stays installed across restarts.

---

### LibreWolf

LibreWolf requires one extra step (Firefox doesn't):

1. Go to `about:config` → search for **`xpinstall.signatures.required`** → set to **`false`**
2. Then follow the Firefox steps above

You only need to do this once.

---

## How to use

1. Visit a site with audio — YouTube, Spotify, a podcast, anything
2. Click the **Audio Engine** icon in your toolbar
3. Move the volume slider — audio responds instantly
4. Hit **Save Rule** to lock in the setting for this domain
5. Done — next time you open that site, it applies automatically

The power button toggles capture for the current tab. The EQ and DRC panels are in the same popup. Options (rule manager, groups, theme) are in the dedicated settings page via the gear icon.

---

## Known Limitations

| Situation | Chrome | Firefox |
|---|---|---|
| DRM content (Netflix, Disney+, Spotify) | Works | Video plays normally, boost not applied |
| Cross-origin media without CORS headers | Works | Audio plays normally, boost not applied |
| `chrome://` and extension pages | No | No |
| Ads inside iframes | No | No |

Firefox's limitations are architectural — `tabCapture` was never implemented in Firefox, so the engine hooks directly into `<video>`/`<audio>` elements on the page instead. DRM-locked streams can't be touched this way without silencing them permanently, so they're intentionally skipped.

---

## Building from source

```bash
# Clone
git clone https://github.com/huseyincancalti/Audio-Engine.git
cd Audio-Engine

# Chrome build
npm install
npm run build       # → dist/
npm run typecheck   # optional, type check only

# Firefox build
cd audio-engine-firefox
npm install
npm run build       # → audio-engine-firefox/dist/
```

**Load in Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select `dist/`

**Load in Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → select `audio-engine-firefox/dist/manifest.json`

---

## Architecture

### Chrome (Manifest V3)

```
┌──────────┐   ENABLE/DISABLE   ┌────────────┐  START_CAPTURE   ┌────────────────────┐
│  Popup   │ ─────────────────► │ Background │ ───────────────► │ Offscreen Document  │
│ (React)  │   UPDATE/STATUS    │  (worker)  │  UPDATE_SETTINGS │  (Web Audio engine) │
└──────────┘                    └────────────┘                   └────────────────────┘
                                      │                                    │
                                      │  getMediaStreamId(tabId)           │ tabCapture stream
                                      └──────────────────────────────────► │ → EQ → Gain → DRC
                                                                            │ → Analyser → dest
```

- **Background service worker**: orchestrates tab capture, resolves rules, manages offscreen lifetime
- **Offscreen document**: one per active capture; processes audio via Web Audio API; returns VU levels
- **Content scripts**: fullscreen sync (MAIN world intercept + ISOLATED world bridge)
- **Popup**: thin view; reads state from background, writes commands back

**Audio chain (per tab):**
```
tabCapture stream → BiquadFilter ×5 (EQ) → GainNode (0–10×) → [ChannelSplitter/Merger (mono?)]
  → DynamicsCompressor → AnalyserNode (VU) → destination
```

---

### Firefox (Manifest V2)

```
┌──────────┐  START_CAPTURE   ┌────────────┐  sendMessage  ┌──────────────────────┐
│  Popup   │ ───────────────► │ Background │ ────────────► │   Content Script      │
│ (React)  │  UPDATE/STOP     │ (persistent│               │  (audio engine lives  │
└──────────┘                  │  bg page)  │               │   here, per tab)      │
                              └────────────┘               └──────────────────────┘
```

- **Background page** (persistent, never sleeps): orchestrates, resolves rules, pings content scripts
- **Content script**: runs the full Web Audio engine inside the page; hooks `<video>`/`<audio>` elements

**Audio chain:**
```
<video>/<audio> element → createMediaElementSource (or MediaStreamSource for WebRTC)
  → BiquadFilter ×5 (EQ) → GainNode → [mono?] → DynamicsCompressor → AnalyserNode → destination
```

**Guards:**
- **DRM guard** — elements with `mediaKeys` set (Netflix EME) are skipped; hooking them would silence them permanently
- **CORS taint guard** — cross-origin elements without CORS headers are skipped for the same reason
- **Neutral passthrough** — "stop" sets gain to 1.0, EQ to 0 dB, DRC to transparent; the Web Audio graph stays wired but audio passes through unchanged

---

### Rule resolution (both browsers)

```
Priority (highest → lowest):
  1. One-off override (user moved slider manually, not saved)
  2. Exact match       music.youtube.com
  3. Subdomain match   *.youtube.com
  4. Wide wildcard     *.com  /  group pattern
  5. Global default

Tie-breaking: score = len(literal chars) − (wildcard count × 10), higher wins
```

---

## Why this exists

Most volume extensions either boost the entire OS (affecting everything) or cap out at 200%. Audio Engine works at the tab level — isolated, per site, with the audio chain you'd expect from a DAW, not a toy slider. The rule engine means you set it once and forget it.

The Firefox port was built because `tabCapture` was never implemented in Firefox ([Bugzilla #1391223](https://bugzilla.mozilla.org/show_bug.cgi?id=1391223), open since 2017). Rather than give up, the engine was redesigned from scratch for that constraint.

---

<br>

<p align="center">
  Made with strong coffee by <a href="https://karakedidub.com">karakedidub</a>
</p>
