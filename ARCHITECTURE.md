# Project Specification: Advanced Browser Audio Engine (Chromium Extension)

## 1. Overview & Objective

An enterprise-grade, high-performance Chromium browser extension (Manifest V3) designed to act as a granular "Browser Audio Engine". It allows users to boost volume up to 1000%, control EQ, convert Stereo to Mono, and automate these settings based on specific URLs or domains (e.g., specific YouTube playlists or domains).

## 2. Core Architectural Principles

- **SOLID Design Principles:** Every class/module must have a single responsibility. Code must be open for extension (e.g., adding AI Noise Canceling later) but closed for modification.
- **Strict TypeScript Typing:** No `any`. Strict interfaces for states, events, and data models.
- **Zero-Server & Security-First:** No external API calls. All data persists locally via `chrome.storage.sync` or `chrome.storage.local`. 
- **Isolated World / Shadow DOM:** Any UI injected into web pages (OSD/Feedback) must be encapsulated inside a Shadow DOM to avoid host CSS pollution.
- **Performance & Garbage Collection:** Explicitly disconnect Web Audio API nodes on tab update/closure to prevent memory leaks.

## 3. Tech Stack

- **Framework:** React.js (for Popup UI / Management Panel)
- **Language:** TypeScript
- **Bundler:** Vite
- **API:** Web Audio API, Chrome Extensions API (Manifest V3)

## 4. System Components & Architecture

The system consists of 3 distinct layers communicating via a decoupled **Pub/Sub Event Bus**:

1. **Popup (Management Panel):** React-based UI to manage global, domain, and exact URL rules, EQ presets, and hotkeys.
2. **Background (Service Worker):** The orchestrator. Monitors tab URLs, manages lifecycle, handle storage sync, and wakes up instantly on tab changes to dispatch configuration to Content Scripts.
3. **Content Script (Audio Processor):** Injected into web pages. Captures `<video>` and `<audio>` tags, routes them through the custom Audio Pipeline, listens to global hotkeys, and renders the OSD feedback.

### 4.1 Audio Pipeline Design

Audio Source -> [BiquadFilterNode (EQ)] -> [StereoPannerNode (Mono/Stereo)] -> [GainNode (Volume Boost)] -> Destination (Speakers)
*Note: Pipeline must be dynamic. If EQ is disabled, the EQ Node should be disconnected from the chain to save CPU.*

### 4.2 Edge Cases & Resilience

- **SPA (Single Page Application) Handling:** Track URL mutations via History API / Mutation Observer since pages like YouTube don't trigger full reloads.
- **Service Worker Re-hydration:** State must be safely restored from `chrome.storage` immediately when the Service Worker wakes up from suspension.
- **Watchdog / Auto-Resume:** Monitor `AudioContext.state`. Automatically trigger `.resume()` on the first user gesture if suspended by browser autoplay policies.
- **Graceful Degradation:** Wrap audio capturing in `try-catch`. If a video is DRM protected (e.g., Netflix) and fails to hook, bypass gracefully without silencing the video.

## 5. Directory Structure

```textile
/src
 ├── /background # Service worker & lifecycle management
 ├── /content # Web Audio API injection & OSD rendering
 ├── /popup # React Management UI
 ├── /core # Pure business logic (SOLID)
 │ ├── /audio # AudioEngine, PipelineManager, FilterChain
 │ ├── /storage # StorageWrapper, DataMigration
 │ └── /messages # EventBus, MessageTypes
 ├── /types # Global TypeScript Interfaces
 └── /utils # Regex matchers, URL parsers
```

## 6. Scope Matrix

### Current MVP Scope:

- Volume Boost up to 1000% with instant tab control.

- 10-Band Graphic Equalizer (EQ).

- Stereo to Mono toggle.

- Rule-based routing (Domain level & Exact URL regex matching).

- Customizable Global Hotkeys with On-Screen Display (OSD) feedback bar.

### Future Extensibility Target (Keep Architecture Open For):

- **AI Noise Canceling Modality:** Integration slot via `AudioWorklet` in the pipeline array.

- **Limiter / Compressor Node:** To prevent audio clipping at high amplification.

- **Cloud Sync Configuration:** Cross-device sync via `chrome.storage.sync`.

---

## Bölüm 2: AI Agent İçin Token Tasarruflu Prompt Döngüsü

Eklentiyi adım adım kodlatırken Sonnet'e vereceğin komutların **açıklama veya laf kalabalığı yapmasını engellemek** için tasarlanmış prompt sıralaması aşağıdadır. Her adımı sırayla gönder:

### Adım 1: Proje Kurulumu ve Konfigürasyon

> **Prompt:** 
> Read the `ARCHITECTURE.md` file. Act as a Senior Web Architect. 
> Generate only the configuration files for the project. Output the exact code without any markdown prose or explanations. 
> Provide:
> 
> 1. `package.json` (with React, TypeScript, Vite, and chrome types)
> 2. `vite.config.ts` (configured for compiling background, content, and popup scripts separately)
> 3. `public/manifest.json` (Manifest V3 template with required permissions: `storage`, `activeTab`, `declarativeContent`)

### Adım 2: Veri Tipleri ve Event Bus (İletişim) Katmanı

> **Prompt:**
> Generate the core communication and typing layer. Output code only. No explanations.
> Provide:
> 
> 1. `src/types/index.ts`: Define strict interfaces for `AudioSettings` (volume, eqBands, isMono), `UrlRule` (id, pattern, settings, priority), and `ExtensionState`.
> 2. `src/core/messages/EventBus.ts`: Implement a strongly-typed Pub/Sub message router using `chrome.runtime.sendMessage` and `onMessage` to coordinate between Popup, Background, and Content scripts.

### Adım 3: Storage ve Veri Göçü Katmanı

> **Prompt:**
> Implement the storage manager following SOLID principles. Output code only. No explanations.
> Provide:
> `src/core/storage/StorageManager.ts`: A TypeScript class handling `chrome.storage.local`. Must include:
> 
> - Methods to save/get URL rules with priority sorting (Exact match beats Domain match).
> - A migration stub checking version numbers to prevent data corruption in future updates.

### Adım 4: Ses İşleme Motoru (Core Audio Engine)

> **Prompt:**
> Implement the Web Audio API Core Engine. Output code only. No explanations.
> Provide:
> `src/core/audio/AudioEngine.ts`: A TypeScript class that instantiates `AudioContext` and sets up the dynamic pipeline: Source -> EQ -> Mono/Stereo -> Gain -> Destination. 
> Requirements:
> 
> - Must dynamically connect/disconnect nodes based on features being active (save CPU).
> - Must include a rigorous cleanup/destructor method to disconnect all nodes and prevent memory leaks.
> - Include a watchdog mechanism to automatically resume `AudioContext` if suspended.

### Adım 5: Arka Plan Yönetimi (Service Worker)

> **Prompt:**
> Implement the Background Orchestrator. Output code only. No explanations.
> Provide:
> `src/background/index.ts`: The Manifest V3 Service Worker.
> Requirements:
> 
> - Listen to tab updates and URL changes (including History API state changes for SPAs).
> - On URL change, fetch matching rules from `StorageManager` and dispatch the targeted audio settings to the specific tab via the `EventBus`.
> - Efficiently handle sleep/wake state hydration.

### Adım 6: Content Script & Shadow DOM OSD (Geri Bildirim)

> **Prompt:**
> Implement the Content Script and the On-Screen Display (OSD). Output code only. No explanations.
> Provide:
> `src/content/index.ts`: Injected script that initializes `AudioEngine` on active media elements.
> Requirements:
> 
> - Listen to global hotkeys.
> - Inject a fully encapsulated OSD (feedback bar) into the host page using **Shadow DOM** so host styles don't break the UI layout.
> - Wrap the audio attachment logic in a `try-catch` block to bypass DRM-protected streams gracefully without crashing the media player.

### Adım 7: React popup (Yönetim Paneli)

> **Prompt:**
> Implement the Popup Management Panel UI. Output code only. No explanations.
> Provide the React components under `src/popup/`:
> 
> - A main control dashboard with volume booster slider (0% to 1000%).
> - An EQ frequency bands controller tab.
> - A URL rules configuration screen where users can map specific rules to domains or exact links.
>   Make sure state changes are pushed immediately to the `EventBus`.

---

Bu döngü sayesinde Sonnet sana sadece saf, temiz ve doğrudan klasörlerine yapıştırabileceğin TypeScript kodları üretecektir. Süreci bu şekilde yöneterek hem zamandan hem de token limitlerinden maksimum tasarruf sağlayabilirsin.
