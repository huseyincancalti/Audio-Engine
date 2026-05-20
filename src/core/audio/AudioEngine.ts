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
  private ctx!: AudioContext;
  private nodes!: PipelineNodes;

  /** Tracks the current logical pipeline state to avoid redundant reconnects. */
  private isEqConnected: boolean = false;
  private isPannerConnected: boolean = false;

  /** Watchdog interval reference for autoplay resume polling. */
  private watchdogId: ReturnType<typeof setInterval> | null = null;

  // ── Construction ───────────────────────────────────────────────────────────

  constructor(mediaElement: HTMLMediaElement) {
    try {
      this.ctx = new AudioContext();

      // Build all nodes upfront; connection topology is wired separately.
      const source = this.ctx.createMediaElementSource(mediaElement);

      // Safely connect source immediately so audio flow is never blocked.
      source.connect(this.ctx.destination);

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

      if (this.ctx.state === 'suspended') {
        console.log('[Audio-Engine] Context suspended by browser');
        this.autoResume();
      }

      this.startWatchdog();
    } catch (err) {
      console.error('[Audio-Engine-Error] AudioEngine constructor failed:', (err as Error).message, err);
      // Ensure audio flow fallback on construction failure
      if (this.nodes && this.nodes.source) {
        try {
          this.nodes.source.connect(this.ctx.destination);
        } catch {}
      }
      throw err;
    }
  }

  // ── Pipeline wiring ────────────────--------------------------------────────

  /**
   * Tear down all inter-node connections and rebuild from scratch based on the
   * provided settings. This is the single method responsible for topology
   * management (SRP) – callers never manipulate connections directly.
   */
  private rebuildPipeline(settings: AudioSettings): void {
    try {
      const { source, eqFilters, panner, gain } = this.nodes;

      // Disconnect everything first to reach a clean slate.
      this.disconnectAll();

      const destination = this.ctx.destination;
      console.log(`[Audio-Engine-Trace] Rebuilding pipeline. Destination sampleRate: ${destination.context.sampleRate}`);

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
    } catch (err) {
      console.error('[Audio-Engine-Error] rebuildPipeline failed:', (err as Error).message, err);
      // Fallback: connect source directly to destination to prevent audio blocking
      try {
        this.disconnectAll();
        this.nodes.source.connect(this.ctx.destination);
      } catch (fallbackErr) {
        console.error('[Audio-Engine-Error] Fallback connection failed:', fallbackErr);
      }
    }
  }

  /**
   * Sever every node's outgoing connections without destroying the nodes.
   * Called before every `rebuildPipeline` to guarantee a clean topology.
   */
  private disconnectAll(): void {
    try {
      const { source, eqFilters, panner, gain } = this.nodes;
      try { source.disconnect(); } catch { /* already disconnected */ }
      for (const filter of eqFilters) {
        try { filter.disconnect(); } catch { /* already disconnected */ }
      }
      try { panner.disconnect(); } catch { /* already disconnected */ }
      try { gain.disconnect(); } catch { /* already disconnected */ }
    } catch (err) {
      console.error('[Audio-Engine-Error] disconnectAll failed:', (err as Error).message, err);
    }
  }

  // ── Public settings API ────────────────--------------------------------────

  /**
   * Apply a new `AudioSettings` snapshot.
   * Only mutates parameters that have actually changed; rebuilds topology only
   * when the active/bypass status of EQ or Mono is toggled.
   */
  applySettings(settings: AudioSettings): void {
    try {
      console.log(`[Audio-Engine-Trace] AudioEngine applying settings. Volume: ${settings.volume}, EQ Enabled: ${settings.isEqEnabled}, Mono: ${settings.isMono}`);
      console.log(`[Audio-Engine-Trace] Current AudioContext state: ${this.ctx.state}`);

      if (this.ctx.state === 'suspended') {
        console.log('[Audio-Engine-Trace] AudioContext is suspended, resuming...');
        this.ctx.resume().catch((err) => {
          console.error('[Audio-Engine-Error] Failed to resume AudioContext:', err);
        });
      }

      // Volume (always safe to update via AudioParam for glitch-free ramping).
      // Ensure gain value is set correctly (e.g. settings.volume = 2.0 applies 2.0 gain).
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
    } catch (err) {
      console.error('[Audio-Engine-Error] applySettings failed:', (err as Error).message, err);
    }
  }

  /**
   * Helper alias to apply settings defensively.
   */
  updateSettings(settings: AudioSettings): void {
    try {
      this.applySettings(settings);
    } catch (err) {
      console.error('[Audio-Engine-Error] updateSettings failed:', (err as Error).message, err);
    }
  }

  // ── Setters for individual parameters ─────────────────────────────────────

  setVolume(value: number): void {
    try {
      this.nodes.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
    } catch (err) {
      console.error('[Audio-Engine-Error] setVolume failed:', (err as Error).message, err);
    }
  }

  setEqBand(bandIndex: number, gainDb: number): void {
    try {
      const filter = this.nodes.eqFilters[bandIndex];
      if (!filter) throw new RangeError(`[AudioEngine] Invalid band index: ${bandIndex}`);
      filter.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.01);
    } catch (err) {
      console.error('[Audio-Engine-Error] setEqBand failed:', (err as Error).message, err);
    }
  }

  // ── Autoplay watchdog ────────────────--------------------------------──────

  /**
   * Some browsers (Chromium) suspend the AudioContext until a user gesture
   * occurs. This watchdog polls the context state every 500 ms and resumes
   * it if needed, satisfying the autoplay policy without blocking.
   *
   * The interval is automatically cleared once the context is running.
   */
  autoResume(): void {
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch((err) => {
          console.error('[Audio-Engine-Error] autoResume failed to resume context:', (err as Error).message, err);
        });
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] autoResume execution threw:', (err as Error).message, err);
    }
  }

  private startWatchdog(): void {
    try {
      if (this.watchdogId !== null) return; // already running

      this.watchdogId = setInterval(() => {
        try {
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
        } catch (err) {
          console.error('[Audio-Engine-Error] Watchdog interval callback threw:', (err as Error).message, err);
        }
      }, 500);
    } catch (err) {
      console.error('[Audio-Engine-Error] startWatchdog failed:', (err as Error).message, err);
    }
  }

  private stopWatchdog(): void {
    try {
      if (this.watchdogId !== null) {
        clearInterval(this.watchdogId);
        this.watchdogId = null;
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] stopWatchdog failed:', (err as Error).message, err);
    }
  }

  // ── Introspection ────────────────────────────────----------------──────────

  get state(): AudioContextState {
    return this.ctx.state;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  // ── Disposal ────────────────────────────────----------------───────────────

  /**
   * Fully tears down the audio graph and closes the AudioContext.
   * Must be called when the associated tab navigates or the content script
   * is unloaded to prevent AudioContext and node memory leaks.
   *
   * After `dispose()` is called this instance must not be reused.
   */
  dispose(): void {
    try {
      this.stopWatchdog();
      this.disconnectAll();

      this.ctx.close().catch((err) => {
        console.error('[Audio-Engine-Error] Error closing AudioContext during dispose:', (err as Error).message, err);
      });
    } catch (err) {
      console.error('[Audio-Engine-Error] dispose failed:', (err as Error).message, err);
    }
  }

  destroy(): void {
    this.dispose();
  }
}
