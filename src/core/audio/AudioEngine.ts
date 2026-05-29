// src/core/audio/AudioEngine.ts
// Web Audio zinciri + 3 katmanlı ses yakalama waterfall (Katman 1 & 2 burada;
// Katman 3 / WebRTC injected.ts'de). ARCHITECTURE.md bölüm 5, 8.

import {
  MAX_GAIN,
  GAIN_TIME_CONSTANT,
  EQ_FREQUENCIES,
  DRC_PARAMS,
  type AudioSettings,
  type CaptureLayer,
} from '../../types/index';

/** Katman önceliği — daha iyi katman daha yüksek. */
const LAYER_RANK: Record<CaptureLayer, number> = {
  media_element: 4,
  media_stream: 3,
  rtc: 2,
  bypass: 1,
  none: 0,
};

interface HookedElement extends HTMLMediaElement {
  dataset: HTMLMediaElement['dataset'] & { audioEngineHooked?: string };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private entry: AudioNode | null = null;

  /** Aynı stream'i iki kez hook'lamayı önler (ARCHITECTURE bölüm 5.4). */
  private readonly hookedStreams = new WeakSet<MediaStream>();

  private volume = 1.0;
  private eq: number[] = EQ_FREQUENCIES.map(() => 0);
  private power = true;
  private drcEnabled = true;

  private bestLayer: CaptureLayer = 'none';

  // -------------------------------------------------------------------------
  // Kurulum
  // -------------------------------------------------------------------------

  private ensureContext(): void {
    if (this.ctx) return;

    const ctx = new AudioContext();
    this.ctx = ctx;

    // EQ: 5 peaking band, EQ_FREQUENCIES ile hizalı, seri bağlı.
    this.eqNodes = EQ_FREQUENCIES.map((freq) => {
      const node = ctx.createBiquadFilter();
      node.type = 'peaking';
      node.frequency.value = freq;
      node.Q.value = 1.0;
      node.gain.value = 0;
      return node;
    });
    for (let i = 0; i < this.eqNodes.length - 1; i++) {
      this.eqNodes[i]!.connect(this.eqNodes[i + 1]!);
    }

    this.gain = ctx.createGain();
    this.gain.gain.value = this.power ? this.volume : 1.0;

    this.compressor = ctx.createDynamicsCompressor();
    this.applyDrcParams();

    // Zincir: [kaynaklar] → eq(seri) → gain → compressor → destination
    this.eqNodes[this.eqNodes.length - 1]!.connect(this.gain);
    this.gain.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    this.entry = this.eqNodes[0]!;

    // Mevcut ayarları uygula.
    this.applyEq();

    // Otomatik uyanmada (kullanıcı jesti yokken) AudioContext 'suspended'
    // kalabilir; createMediaElementSource sonrası bu sesi TAMAMEN keser.
    // İlk kullanıcı etkileşiminde resume et (autoplay politikası).
    const resume = () => this.resumeIfSuspended();
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, resume, { capture: true, passive: true });
    }
  }

  private resumeIfSuspended(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        /* jest gerekiyor, sonraki etkileşimde tekrar denenir */
      });
    }
  }

  // -------------------------------------------------------------------------
  // Katman waterfall — attachToSource (ARCHITECTURE bölüm 5.2)
  // -------------------------------------------------------------------------

  /**
   * Bir ses kaynağını zincire bağlar. Sıra: element → element.srcObject →
   * doğrudan stream/track. Hiçbiri olmazsa 'bypass'.
   */
  attachToSource(target: HTMLMediaElement | MediaStream | MediaStreamTrack): CaptureLayer {
    this.ensureContext();
    this.resumeIfSuspended();

    let layer: CaptureLayer = 'bypass';

    if (target instanceof HTMLMediaElement) {
      layer = this.attachElement(target);
    } else if (typeof MediaStream !== 'undefined' && target instanceof MediaStream) {
      layer = this.attachStream(target);
    } else if (typeof MediaStreamTrack !== 'undefined' && target instanceof MediaStreamTrack) {
      layer = this.attachStream(new MediaStream([target]));
    }

    if (LAYER_RANK[layer] > LAYER_RANK[this.bestLayer]) {
      this.bestLayer = layer;
    }
    return layer;
  }

  /** Katman 1 — MediaElementSource; başarısızsa Katman 2 (element.srcObject). */
  private attachElement(el: HTMLMediaElement): CaptureLayer {
    const hooked = el as HookedElement;
    if (hooked.dataset.audioEngineHooked === '1') {
      return this.bestLayer === 'none' ? 'media_element' : this.bestLayer;
    }

    // Katman 1
    try {
      const source = this.ctx!.createMediaElementSource(el);
      source.connect(this.entry!);
      hooked.dataset.audioEngineHooked = '1';
      return 'media_element';
    } catch (err) {
      // createMediaElementSource başarısız (zaten kullanılıyor / güvenlik) → Katman 2.
      console.debug('[AudioEngine] Katman 1 başarısız, Katman 2 deneniyor:', err);
    }

    // Katman 2 — element.srcObject bir MediaStream ise
    const srcObj = (el as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject;
    if (typeof MediaStream !== 'undefined' && srcObj instanceof MediaStream) {
      const layer = this.attachStream(srcObj);
      if (layer !== 'bypass') hooked.dataset.audioEngineHooked = '1';
      return layer;
    }

    return 'bypass';
  }

  /** Katman 2 — MediaStreamSource. */
  private attachStream(stream: MediaStream): CaptureLayer {
    if (this.hookedStreams.has(stream)) return 'media_stream';
    if (stream.getAudioTracks().length === 0) return 'bypass';
    try {
      const source = this.ctx!.createMediaStreamSource(stream);
      source.connect(this.entry!);
      this.hookedStreams.add(stream);
      return 'media_stream';
    } catch (err) {
      console.debug('[AudioEngine] Katman 2 başarısız:', err);
      return 'bypass';
    }
  }

  // -------------------------------------------------------------------------
  // Parametre uygulama
  // -------------------------------------------------------------------------

  private applyEq(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.eqNodes.forEach((node, i) => {
      node.gain.setTargetAtTime(this.eq[i] ?? 0, now, 0.01);
    });
  }

  private applyGain(): void {
    if (!this.ctx || !this.gain) return;
    const target = this.power ? this.volume : 1.0;
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, GAIN_TIME_CONSTANT);
  }

  private applyDrcParams(): void {
    if (!this.compressor || !this.ctx) return;
    const now = this.ctx.currentTime;
    const active = this.power && this.drcEnabled;
    const c = this.compressor;
    if (active) {
      c.threshold.setValueAtTime(DRC_PARAMS.threshold, now);
      c.knee.setValueAtTime(DRC_PARAMS.knee, now);
      c.ratio.setValueAtTime(DRC_PARAMS.ratio, now);
      c.attack.setValueAtTime(DRC_PARAMS.attack, now);
      c.release.setValueAtTime(DRC_PARAMS.release, now);
    } else {
      // Zincirde kalır ama transparan (ARCHITECTURE bölüm 14).
      c.threshold.setValueAtTime(0, now);
      c.knee.setValueAtTime(0, now);
      c.ratio.setValueAtTime(1, now);
      c.attack.setValueAtTime(DRC_PARAMS.attack, now);
      c.release.setValueAtTime(DRC_PARAMS.release, now);
    }
  }

  // -------------------------------------------------------------------------
  // Genel API
  // -------------------------------------------------------------------------

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(MAX_GAIN, volume));
    this.applyGain();
  }

  setEq(bands: number[]): void {
    this.eq = EQ_FREQUENCIES.map((_, i) => bands[i] ?? 0);
    this.applyEq();
  }

  setDrcEnabled(enabled: boolean): void {
    this.drcEnabled = enabled;
    this.applyDrcParams();
  }

  setPower(on: boolean): void {
    this.power = on;
    this.applyGain();
    this.applyDrcParams();
  }

  applySettings(settings: AudioSettings): void {
    this.setVolume(settings.volume);
    this.setEq(settings.eq);
  }

  getCaptureLayer(): CaptureLayer {
    return this.bestLayer;
  }

  isBypassed(): boolean {
    return this.bestLayer === 'bypass';
  }

  hasContext(): boolean {
    return this.ctx !== null;
  }

  getVolume(): number {
    return this.volume;
  }

  getEq(): number[] {
    return [...this.eq];
  }
}
