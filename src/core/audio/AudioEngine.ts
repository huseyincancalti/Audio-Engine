// src/core/audio/AudioEngine.ts

import type { AudioSettings } from '@/types/index';
import { DEFAULT_AUDIO_SETTINGS } from '@/types/index';

declare global {
  interface Window {
    __audioEngineRegistry?: Map<HTMLMediaElement, AudioEngine>;
  }
}

// ---------------------------------------------------------------------------
// EQ frequencies
// ---------------------------------------------------------------------------

const EQ_FREQUENCIES: readonly number[] = Object.freeze([
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
]);

interface PipelineNodes {
  source: MediaElementAudioSourceNode;
  eqFilters: BiquadFilterNode[];
  panner: StereoPannerNode;
  gain: GainNode;
}

export class AudioEngine {
  private ctx!: AudioContext;
  private nodes?: PipelineNodes;
  private isEqConnected: boolean = false;
  private isPannerConnected: boolean = false;
  private watchdogId: ReturnType<typeof setInterval> | null = null;
  
  // 3. Strict Non-Blocking Passthrough Strategy flag
  private isBypassed: boolean = false;

  constructor(mediaElement: HTMLMediaElement) {
    if (!window.__audioEngineRegistry) {
      window.__audioEngineRegistry = new Map();
    }

    const existing = window.__audioEngineRegistry.get(mediaElement);
    if (existing) {
      console.log('[Audio-Engine] Reusing existing AudioEngine from registry.');
      return existing;
    }

    try {
      this.ctx = new AudioContext();

      let source: MediaElementAudioSourceNode | null = null;
      try {
        source = this.ctx.createMediaElementSource(mediaElement);
      } catch (err) {
        console.warn('[Audio-Engine-Safe-Bypass] Element locked by host script, bypassing.', err);
        this.isBypassed = true;
      }

      if (source && !this.isBypassed) {
        const eqFilters = EQ_FREQUENCIES.map((freq, i) => {
          const filter = this.ctx.createBiquadFilter();
          if (i === 0) {
            filter.type = 'lowshelf';
          } else if (i === EQ_FREQUENCIES.length - 1) {
            filter.type = 'highshelf';
          } else {
            filter.type = 'peaking';
          }
          filter.frequency.value = freq;
          filter.Q.value = 1.41;
          filter.gain.value = 0;
          return filter;
        });

        const panner = this.ctx.createStereoPanner();
        panner.pan.value = 0;

        const gain = this.ctx.createGain();
        gain.gain.value = DEFAULT_AUDIO_SETTINGS.volume;

        this.nodes = { source, eqFilters, panner, gain };
        this.rebuildPipeline(DEFAULT_AUDIO_SETTINGS);
      } else {
        console.log('[Audio-Engine] Operating in pure passthrough mode. Native audio untouched.');
      }

      if (this.ctx.state === 'suspended') {
        this.autoResume();
      }

      this.startWatchdog();
      window.__audioEngineRegistry.set(mediaElement, this);
    } catch (err) {
      console.error('[Audio-Engine-Error] AudioEngine constructor failed:', (err as Error).message, err);
      this.isBypassed = true;
      throw err;
    }
  }

  // Expose the bypassed state for content script state guard validation
  public getIsBypassed(): boolean {
    return this.isBypassed;
  }

  private rebuildPipeline(settings: AudioSettings): void {
    if (this.isBypassed || !this.nodes) return;

    try {
      const { source, eqFilters, panner, gain } = this.nodes;
      this.disconnectAll();

      const destination = this.ctx.destination;

      if (settings.isEqEnabled && !settings.isMono) {
        source.connect(eqFilters[0]!);
        for (let i = 0; i < eqFilters.length - 1; i++) {
          eqFilters[i]!.connect(eqFilters[i + 1]!);
        }
        eqFilters[eqFilters.length - 1]!.connect(gain);
        gain.connect(destination);
        this.isEqConnected = true;
        this.isPannerConnected = false;
      } else if (settings.isEqEnabled && settings.isMono) {
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
        source.connect(panner);
        panner.connect(gain);
        gain.connect(destination);
        this.isEqConnected = false;
        this.isPannerConnected = true;
      } else {
        source.connect(gain);
        gain.connect(destination);
        this.isEqConnected = false;
        this.isPannerConnected = false;
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] rebuildPipeline failed:', err);
      this.isBypassed = true;
    }
  }

  private disconnectAll(): void {
    if (this.isBypassed || !this.nodes) return;
    try {
      const { source, eqFilters, panner, gain } = this.nodes;
      try { source.disconnect(); } catch {}
      for (const filter of eqFilters) {
        try { filter.disconnect(); } catch {}
      }
      try { panner.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    } catch (err) {
      console.error('[Audio-Engine-Error] disconnectAll failed:', err);
    }
  }

  applySettings(settings: AudioSettings): void {
    if (this.isBypassed) {
      return;
    }

    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch((err) => {
          console.error('[Audio-Engine-Error] Failed to resume AudioContext:', err);
        });
      }

      if (!this.nodes) return;

      this.nodes.gain.gain.setTargetAtTime(settings.volume, this.ctx.currentTime, 0.01);

      if (settings.isEqEnabled) {
        settings.eqBands.forEach((gainDb, i) => {
          const filter = this.nodes?.eqFilters[i];
          if (filter) {
            filter.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.01);
          }
        });
      }

      if (settings.isMono) {
        this.nodes.panner.pan.setTargetAtTime(0, this.ctx.currentTime, 0.01);
      }

      const topologyChanged =
        settings.isEqEnabled !== this.isEqConnected ||
        settings.isMono !== this.isPannerConnected;

      if (topologyChanged) {
        this.rebuildPipeline(settings);
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] applySettings failed:', err);
    }
  }

  updateSettings(settings: AudioSettings): void {
    this.applySettings(settings);
  }

  setVolume(value: number): void {
    if (this.isBypassed || !this.nodes) return;
    try {
      this.nodes.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
    } catch (err) {
      console.error('[Audio-Engine-Error] setVolume failed:', err);
    }
  }

  setEqBand(bandIndex: number, gainDb: number): void {
    if (this.isBypassed || !this.nodes) return;
    try {
      const filter = this.nodes.eqFilters[bandIndex];
      if (filter) {
        filter.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.01);
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] setEqBand failed:', err);
    }
  }

  getContextState(): AudioContextState {
    return this.ctx?.state ?? 'closed';
  }

  async resumeContext(): Promise<void> {
    if (this.isBypassed) return;
    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] resumeContext failed:', err);
    }
  }

  autoResume(): void {
    if (this.isBypassed) return;
    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] autoResume threw:', err);
    }
  }

  private startWatchdog(): void {
    if (this.isBypassed) return;
    try {
      if (this.watchdogId !== null) return;
      this.watchdogId = setInterval(() => {
        try {
          if (this.ctx.state === 'closed' || this.isBypassed) {
            this.stopWatchdog();
            return;
          }
          if (this.ctx.state === 'suspended') {
            this.autoResume();
          } else if (this.ctx.state === 'running') {
            this.stopWatchdog();
          }
        } catch (err) {
          console.error('[Audio-Engine-Error] Watchdog interval callback threw:', err);
        }
      }, 500);
    } catch (err) {
      console.error('[Audio-Engine-Error] startWatchdog failed:', err);
    }
  }

  private stopWatchdog(): void {
    try {
      if (this.watchdogId !== null) {
        clearInterval(this.watchdogId);
        this.watchdogId = null;
      }
    } catch (err) {
      console.error('[Audio-Engine-Error] stopWatchdog failed:', err);
    }
  }

  get state(): AudioContextState {
    return this.ctx.state;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  dispose(): void {
    try {
      this.stopWatchdog();
      if (!this.isBypassed) {
        this.disconnectAll();
      }
      this.ctx.close().catch(() => {});
    } catch (err) {
      console.error('[Audio-Engine-Error] dispose failed:', err);
    }
  }

  destroy(): void {
    this.dispose();
  }
}
