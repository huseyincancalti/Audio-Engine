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
  tab_capture: 5,
  media_element: 4,
  media_stream: 3,
  rtc: 2,
  bypass: 1,
  none: 0,
};

interface HookedElement extends HTMLMediaElement {
  dataset: HTMLMediaElement['dataset'] & { audioEngineHooked?: string };
}

/** tabCapture streamId sağlayıcısı — content script enjekte eder (chrome API content'te). */
export type TabCaptureProvider = () => Promise<string | null>;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private eqNodes: BiquadFilterNode[] = [];
  private entry: AudioNode | null = null;

  /** Mono indirgeme düğümleri (son EQ → splitter/merger → gain). */
  private monoSplitter: ChannelSplitterNode | null = null;
  private monoMerger: ChannelMergerNode | null = null;
  private isMono = false;

  /** Aynı stream'i iki kez hook'lamayı önler (ARCHITECTURE bölüm 5.4). */
  private readonly hookedStreams = new WeakSet<MediaStream>();

  /** Layer 2 — tabCapture streamId sağlayıcısı (sadece content script set eder). */
  private tabCaptureProvider: TabCaptureProvider | null = null;
  /** Tüm sekme zaten yakalanıyor mu? (tabCapture sekme bazlı, element bazlı değil). */
  private tabCaptureActive = false;

  private volume = 1.0;
  private eq: number[] = EQ_FREQUENCIES.map(() => 0);
  private power = true;
  private drcEnabled = true;

  private bestLayer: CaptureLayer = 'none';

  /** content script burada chrome.runtime üzerinden streamId döndüren provider verir. */
  setTabCaptureProvider(provider: TabCaptureProvider): void {
    this.tabCaptureProvider = provider;
  }

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

    // Zincir: [kaynaklar] → eq(seri) → [mono?] → gain → compressor → destination
    this.gain.connect(this.compressor);
    this.compressor.connect(ctx.destination);
    this.entry = this.eqNodes[0]!;
    this.applyMonoRouting(); // son EQ'yu gain'e (veya mono düğümlerine) bağlar

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

  private isResumable(): boolean {
    const st = this.ctx?.state as string | undefined;
    return st === 'suspended' || st === 'interrupted';
  }

  private resumeIfSuspended(): void {
    if (this.ctx && this.isResumable()) {
      void this.ctx.resume().catch(() => {
        /* jest gerekiyor, sonraki etkileşimde tekrar denenir */
      });
    }
  }

  /** attachToSource başında çağrılır — context askıdaysa await ile uyandırır. */
  async resumeContext(): Promise<void> {
    if (this.ctx && this.isResumable()) {
      try {
        await this.ctx.resume();
      } catch {
        /* kullanıcı jesti gerekiyor; click handler tekrar dener */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mono / Stereo yönlendirme
  // -------------------------------------------------------------------------

  /** Son EQ düğümünü gain'e bağlar; mono açıksa araya splitter+merger koyar. */
  private applyMonoRouting(): void {
    if (!this.ctx || !this.gain) return;
    const last = this.eqNodes[this.eqNodes.length - 1];
    if (!last) return;

    // Eski yönlendirmeyi söküp temizle.
    try {
      last.disconnect();
    } catch {
      /* zaten bağlı değil */
    }
    this.monoSplitter?.disconnect();
    this.monoMerger?.disconnect();
    this.monoSplitter = null;
    this.monoMerger = null;

    if (this.isMono) {
      // Stereo → Mono: L ve R kanallarını tek kanala topla.
      const splitter = this.ctx.createChannelSplitter(2);
      const merger = this.ctx.createChannelMerger(1);
      last.connect(splitter);
      splitter.connect(merger, 0, 0); // L → mono
      splitter.connect(merger, 1, 0); // R → mono
      merger.connect(this.gain);
      this.monoSplitter = splitter;
      this.monoMerger = merger;
    } else {
      last.connect(this.gain);
    }
  }

  setMono(enabled: boolean): void {
    if (this.isMono === enabled) return;
    this.isMono = enabled;
    if (this.ctx) this.applyMonoRouting();
  }

  // -------------------------------------------------------------------------
  // Katman waterfall — attachToSource (ARCHITECTURE bölüm 5.2)
  // -------------------------------------------------------------------------

  /**
   * Bir ses kaynağını zincire bağlar.
   * Element için: Katman 1 (MediaElementSource) → CORS hatasında Katman 2 (tabCapture
   * otomatik fallback) → Katman 3 (WebRTC, injected.ts'de) → bypass.
   * Stream/track için: doğrudan MediaStreamSource.
   */
  async attachToSource(
    target: HTMLMediaElement | MediaStream | MediaStreamTrack,
  ): Promise<CaptureLayer> {
    this.ensureContext();
    await this.resumeContext();

    let layer: CaptureLayer = 'bypass';

    if (target instanceof HTMLMediaElement) {
      layer = await this.attachElement(target);
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

  /** Katman 1 — MediaElementSource; CORS/SecurityError'da tabCapture fallback. */
  private async attachElement(el: HTMLMediaElement): Promise<CaptureLayer> {
    const hooked = el as HookedElement;
    if (hooked.dataset.audioEngineHooked === '1') {
      return this.bestLayer === 'none' ? 'media_element' : this.bestLayer;
    }

    // Tüm sekme zaten tabCapture ile yakalanıyorsa: bu elementi de sustur, çift ses olmasın.
    if (this.tabCaptureActive) {
      el.muted = true;
      hooked.dataset.audioEngineHooked = '1';
      return 'tab_capture';
    }

    // KATMAN 1 — normal MediaElementSource
    try {
      const source = this.ctx!.createMediaElementSource(el);
      source.connect(this.entry!);
      hooked.dataset.audioEngineHooked = '1';
      return 'media_element';
    } catch (err) {
      console.log('[AE] Layer 1 failed:', (err as Error)?.name, '→ trying tabCapture');
    }

    // KATMAN 1b — element.srcObject bir MediaStream ise (WebRTC <video> srcObject)
    const srcObj = (el as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject;
    if (typeof MediaStream !== 'undefined' && srcObj instanceof MediaStream) {
      const layer = this.attachStream(srcObj);
      if (layer !== 'bypass') {
        hooked.dataset.audioEngineHooked = '1';
        return layer;
      }
    }

    // KATMAN 2 — tabCapture otomatik fallback (cross-origin video: TikTok/Instagram/Netflix)
    if (this.tabCaptureProvider) {
      const streamId = await this.tabCaptureProvider();
      if (streamId && (await this.attachTabStream(streamId))) {
        el.muted = true; // tabCapture sesi zaten verecek → orijinali sustur
        hooked.dataset.audioEngineHooked = '1';
        return 'tab_capture';
      }
    }

    // KATMAN 3 (WebRTC injection) injected.ts'de ele alınır.
    return 'bypass';
  }

  /** MediaStreamSource — Katman 1b/3 ve tabCapture ortak yolu. */
  private attachStream(stream: MediaStream): CaptureLayer {
    if (this.hookedStreams.has(stream)) return 'media_stream';
    if (stream.getAudioTracks().length === 0) return 'bypass';
    try {
      const source = this.ctx!.createMediaStreamSource(stream);
      source.connect(this.entry!);
      this.hookedStreams.add(stream);
      return 'media_stream';
    } catch (err) {
      console.debug('[AudioEngine] MediaStreamSource başarısız:', err);
      return 'bypass';
    }
  }

  /** tabCapture streamId → getUserMedia → zincire bağla. Başarılıysa bestLayer = tab_capture. */
  private async attachTabStream(streamId: string): Promise<boolean> {
    this.ensureContext();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      } as unknown as MediaStreamConstraints);
      if (stream.getAudioTracks().length === 0) return false;
      const source = this.ctx!.createMediaStreamSource(stream);
      source.connect(this.entry!);
      this.hookedStreams.add(stream);
      this.bestLayer = 'tab_capture';
      this.tabCaptureActive = true;
      console.info('[AE] tabCapture attached (Layer 2)');
      return true;
    } catch (err) {
      console.log('[AE] Layer 2 tabCapture failed:', err);
      return false;
    }
  }

  /** Manuel tabCapture akışı (popup → content → buraya streamId iletir). */
  async hookTabCapture(streamId: string): Promise<boolean> {
    if (this.tabCaptureActive) return true;
    await this.resumeContext();
    return this.attachTabStream(streamId);
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

  tryResume(): void {
    this.resumeIfSuspended();
  }

  getCaptureLayer(): CaptureLayer {
    return this.bestLayer;
  }

  isBypassed(): boolean {
    return this.bestLayer === 'bypass';
  }

  /** Gerçek bir kaynağa bağlandı mı (bypass/none dışında)? */
  isActive(): boolean {
    return this.bestLayer !== 'none' && this.bestLayer !== 'bypass';
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
