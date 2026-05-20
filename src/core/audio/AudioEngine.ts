// src/core/audio/AudioEngine.ts

import type { AudioSettings } from '@/types/index';
import { DEFAULT_AUDIO_SETTINGS } from '@/types/index';

// ---------------------------------------------------------------------------
// EQ band centre frequencies (10-band graphic EQ, ISO standard)
// ---------------------------------------------------------------------------

const EQ_FREQUENCIES: readonly number[] = Object.freeze([
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
]);

// ---------------------------------------------------------------------------
// Pipeline node container – keeps all nodes co-located for clean teardown
// ---------------------------------------------------------------------------

interface PipelineNodes {
  source: MediaElementAudioSourceNode;
  eqFilters: BiquadFilterNode[];
  panner: StereoPannerNode;
  gain: GainNode;
}

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------

export class AudioEngine {
  private readonly ctx: AudioContext;
  private readonly nodes: PipelineNodes;

  /** Tracks the current logical pipeline state to avoid redundant reconnects. */
  private isEqConnected: boolean = false;
  private isPannerConnected: boolean = false;

  /** Watchdog interval reference for autoplay resume polling. */
  private watchdogId: ReturnType<typeof setInterval> | null = null;

  // ── Construction ───────────────────────────────────────────────────────────

  constructor(mediaElement: HTMLMediaElement) {
    this.ctx = new AudioContext();

    // Build all nodes upfront; connection topology is wired separately.
    const source = this.ctx.createMediaElementSource(mediaElement);

    const eqFilters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = this.ctx.createBiquadFilter();
      // First and last bands use shelving filters for a proper graphic EQ curve.
      if (i === 0) {
        filter.type = 'lowshelf';
      } else if (i === EQ_FREQUENCIES.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
      }
      filter.frequency.value = freq;
      filter.Q.value = 1.41; // ~1 octave bandwidth per band
      filter.gain.value = 0;
      return filter;
    });

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = 0;

    const gain = this.ctx.createGain();
    gain.gain.value = DEFAULT_AUDIO_SETTINGS.volume;

    this.nodes = { source, eqFilters, panner, gain };

    // Wire the initial pipeline with defaults (EQ bypassed, panner bypassed).
    this.rebuildPipeline(DEFAULT_AUDIO_SETTINGS);
    this.startWatchdog();
  }

  // ── Pipeline wiring ────────────────────────────────────────────────────────

  /**
   * Tear down all inter-node connections and rebuild from scratch based on the
   * provided settings. This is the single method responsible for topology
   * management (SRP) – callers never manipulate connections directly.
   */
  private rebuildPipeline(settings: AudioSettings): void {
    const { source, eqFilters, panner, gain } = this.nodes;

    // Disconnect everything first to reach a clean slate.
    this.disconnectAll();

    const destination = this.ctx.destination;

    if (settings.isEqEnabled && !settings.isMono) {
      // Source → EQ chain → Gain → Destination
      source.connect(eqFilters[0]!);
      for (let i = 0; i < eqFilters.length - 1; i++) {
        eqFilters[i]!.connect(eqFilters[i + 1]!);
      }
      eqFilters[eqFilters.length - 1]!.connect(gain);
      gain.connect(destination);
      this.isEqConnected = true;
      this.isPannerConnected = false;

    } else if (settings.isEqEnabled && settings.isMono) {
      // Source → EQ chain → Panner (mono sum) → Gain → Destination
      source.connect(eqFilters[0]!);
      for (let i = 0; i < eqFilters.length - 1; i++) {
        eqFilters[i]!.connect(eqFilters[i + 1]!);
      }
      eqFilters[eqFilters.length - 1]!.connect(panner);
      panner.connect(gain);
      gain.connect(destination);
      this.isEqConnected = true;
      this.isPannerConnected = true;

    } else if (!settings.isEqEnabled && settings.isMono) {
      // Source → Panner (mono sum) → Gain → Destination  [EQ bypassed]
      source.connect(panner);
      panner.connect(gain);
      gain.connect(destination);
      this.isEqConnected = false;
      this.isPannerConnected = true;

    } else {
      // Source → Gain → Destination  [EQ bypassed, Panner bypassed]
      source.connect(gain);
      gain.connect(destination);
      this.isEqConnected = false;
      this.isPannerConnected = false;
    }
  }

  /**
   * Sever every node's outgoing connections without destroying the nodes.
   * Called before every `rebuildPipeline` to guarantee a clean topology.
   */
  private disconnectAll(): void {
    const { source, eqFilters, panner, gain } = this.nodes;
    try { source.disconnect(); } catch { /* already disconnected */ }
    for (const filter of eqFilters) {
      try { filter.disconnect(); } catch { /* already disconnected */ }
    }
    try { panner.disconnect(); } catch { /* already disconnected */ }
    try { gain.disconnect(); } catch { /* already disconnected */ }
  }

  // ── Public settings API ────────────────────────────────────────────────────

  /**
   * Apply a new `AudioSettings` snapshot.
   * Only mutates parameters that have actually changed; rebuilds topology only
   * when the active/bypass status of EQ or Mono is toggled.
   */
  applySettings(settings: AudioSettings): void {
    // Volume (always safe to update via AudioParam for glitch-free ramping).
    this.nodes.gain.gain.setTargetAtTime(
      settings.volume,
      this.ctx.currentTime,
      0.01, // ~10 ms smooth ramp to avoid click artefacts
    );

    // EQ band gains.
    if (settings.isEqEnabled) {
      settings.eqBands.forEach((gainDb, i) => {
        const filter = this.nodes.eqFilters[i];
        if (filter) {
          filter.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.01);
        }
      });
    }

    // Mono: panner pan = 0 collapses L+R to centre when routed through it.
    if (settings.isMono) {
      this.nodes.panner.pan.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    }

    // Rebuild topology if EQ enable-state or mono-state changed.
    const topologyChanged =
      settings.isEqEnabled !== this.isEqConnected ||
      settings.isMono !== this.isPannerConnected;

    if (topologyChanged) {
      this.rebuildPipeline(settings);
    }
  }

  // ── Setters for individual parameters ─────────────────────────────────────

  setVolume(value: number): void {
    this.nodes.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }

  setEqBand(bandIndex: number, gainDb: number): void {
    const filter = this.nodes.eqFilters[bandIndex];
    if (!filter) throw new RangeError(`[AudioEngine] Invalid band index: ${bandIndex}`);
    filter.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.01);
  }

  // ── Autoplay watchdog ──────────────────────────────────────────────────────

  /**
   * Some browsers (Chromium) suspend the AudioContext until a user gesture
   * occurs. This watchdog polls the context state every 500 ms and resumes
   * it if needed, satisfying the autoplay policy without blocking.
   *
   * The interval is automatically cleared once the context is running.
   */
  autoResume(): void {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err) => {
        console.warn('[AudioEngine] autoResume failed:', err);
      });
    }
  }

  private startWatchdog(): void {
    if (this.watchdogId !== null) return; // already running

    this.watchdogId = setInterval(() => {
      if (this.ctx.state === 'closed') {
        this.stopWatchdog();
        return;
      }
      if (this.ctx.state === 'suspended') {
        this.autoResume();
      } else if (this.ctx.state === 'running') {
        // Context is healthy – watchdog job is done.
        this.stopWatchdog();
      }
    }, 500);
  }

  private stopWatchdog(): void {
    if (this.watchdogId !== null) {
      clearInterval(this.watchdogId);
      this.watchdogId = null;
    }
  }

  // ── Introspection ──────────────────────────────────────────────────────────

  get state(): AudioContextState {
    return this.ctx.state;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  // ── Disposal ───────────────────────────────────────────────────────────────

  /**
   * Fully tears down the audio graph and closes the AudioContext.
   * Must be called when the associated tab navigates or the content script
   * is unloaded to prevent AudioContext and node memory leaks.
   *
   * After `destroy()` is called this instance must not be reused.
   */
  destroy(): void {
    this.stopWatchdog();
    this.disconnectAll();

    this.ctx.close().catch((err) => {
      console.warn('[AudioEngine] Error closing AudioContext:', err);
    });
  }
}
