// src/content/engine.ts — Firefox ses motoru
// Firefox'ta tabCapture/offscreen YOK; ses, sayfadaki media elementlerinden
// Web Audio ile işlenir:
//
//   Katman 1 — createMediaElementSource: elementin çıkışını zincire yönlendirir
//              (orijinal playback otomatik susar, çift ses olmaz).
//   Katman 2 — srcObject MediaStream (WebRTC <audio>/<video>, ör. Google Meet):
//              Katman 1 başarısız olursa stream doğrudan bağlanır ve element
//              mute edilir (çift ses önlenir).
//   DRM guard — el.mediaKeys dolu ise (Netflix/EME) element ATLANIR: Web Audio
//              DRM'li sesi sessizleştirir; orijinal playback'e dokunmamak,
//              videoyu bozmamak demektir.
//
// Zincir: kaynaklar → EQ(seri) → gain → [mono?] → drc(kapalıyken transparan)
//         → analyser → destination
//
// createMediaElementSource GERİ ALINAMAZ; bu yüzden "durdur" = nötr geçiş
// (gain 1.0, EQ düz, DRC transparan, mono kapalı) — ses orijinal halini alır.

import {
  EQ_FREQUENCIES,
  GAIN_TIME_CONSTANT,
  DRC_PARAMS,
  MAX_GAIN,
  type CaptureSettings,
  type CaptureLayer,
  type EngineState,
  type EngineStatus,
} from '../types/index';

const HOOK_FLAG = 'audioEngineHooked';

interface HookedElement extends HTMLMediaElement {
  dataset: HTMLMediaElement['dataset'] & { audioEngineHooked?: string };
}

/** root (document veya açık shadow root) altındaki tüm media elementlerini
 *  shadow DOM'a inerek toplar — modern oynatıcılar custom element kullanıyor. */
function collectMedia(root: ParentNode, out: HTMLMediaElement[], depth = 0): void {
  if (depth > 6) return; // güvenlik sınırı
  root.querySelectorAll<HTMLElement>('video, audio, *').forEach((el) => {
    if (el instanceof HTMLMediaElement) out.push(el);
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) collectMedia(sr, out, depth + 1);
  });
}

export class ContentAudioEngine {
  private ctx: AudioContext | null = null;
  private eqBands: BiquadFilterNode[] = [];
  private gain: GainNode | null = null;
  private drc: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private monoSplitter: ChannelSplitterNode | null = null;
  private monoMerger: ChannelMergerNode | null = null;
  private entry: AudioNode | null = null;

  private hookedStreams = new WeakSet<MediaStream>();
  private observer: MutationObserver | null = null;

  /** İşleme aktif mi? Kapalıyken zincir nötr geçiştir (ayar uygulanmaz). */
  private active = false;
  private settings: CaptureSettings = { volume: 1, eq: [0, 0, 0, 0, 0], drcEnabled: false, monoEnabled: false };
  private bestLayer: CaptureLayer = 'none';

  // Durum sayaçları — popup'a "neden çalışmıyor"u anlatmak için.
  private attached = 0;
  private skippedDrm = 0;
  private skippedCors = 0;
  /** Context suspended olduğu için bağlanma ertelendi mi? (sesi susturmamak için) */
  private pendingResume = false;

  /** Durum değişince haber ver (content/index → background'a iletir). */
  onStatus: ((s: EngineStatus) => void) | null = null;

  private emit(): void {
    this.onStatus?.(this.getStatus());
  }

  // -------------------------------------------------------------------------
  // Kurulum
  // -------------------------------------------------------------------------

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;

    const ctx = new AudioContext();
    this.ctx = ctx;

    this.eqBands = EQ_FREQUENCIES.map((freq) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = freq;
      b.Q.value = 1;
      b.gain.value = 0;
      return b;
    });
    for (let i = 0; i < this.eqBands.length - 1; i++) {
      this.eqBands[i]!.connect(this.eqBands[i + 1]!);
    }
    this.entry = this.eqBands[0]!;

    this.gain = ctx.createGain();
    this.gain.gain.value = 1;

    this.drc = ctx.createDynamicsCompressor();
    this.applyDrcParams();

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 32;

    // son EQ → gain → [mono?] → drc → analyser → destination
    this.eqBands[this.eqBands.length - 1]!.connect(this.gain);
    this.applyMonoRouting();
    this.analyser.connect(ctx.destination);

    // Autoplay politikası: kullanıcı jesti olmadan context 'suspended' kalabilir;
    // createMediaElementSource sonrası bu sesi TAMAMEN keser. İlk etkileşimde resume.
    const resume = () => this.resumeIfSuspended();
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, resume, { capture: true, passive: true });
    }

    return ctx;
  }

  private resumeIfSuspended(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx
        .resume()
        .then(() => {
          // Resume başarılı → context artık çalışıyor. Suspended yüzünden ertelenen
          // bağlanmaları şimdi yap (artık ses ölmez) ve durumu güncelle.
          if (this.ctx?.state === 'running') {
            if (this.pendingResume) {
              this.pendingResume = false;
              this.attachAllMedia();
              this.applyParams();
            }
            this.emit();
          }
        })
        .catch(() => {
          /* jest gerekiyor; sonraki etkileşimde tekrar denenir */
        });
    }
  }

  /** gain → [mono?] → drc bağlantısını (yeniden) kurar. */
  private applyMonoRouting(): void {
    if (!this.ctx || !this.gain || !this.drc || !this.analyser) return;

    try {
      this.gain.disconnect();
    } catch {
      /* henüz bağlı değil */
    }
    this.monoSplitter?.disconnect();
    this.monoMerger?.disconnect();
    this.monoSplitter = null;
    this.monoMerger = null;
    try {
      this.drc.disconnect();
    } catch {
      /* henüz bağlı değil */
    }

    const monoOn = this.active && this.settings.monoEnabled;
    if (monoOn) {
      const splitter = this.ctx.createChannelSplitter(2);
      const merger = this.ctx.createChannelMerger(1);
      this.gain.connect(splitter);
      splitter.connect(merger, 0, 0); // L → mono
      splitter.connect(merger, 1, 0); // R → mono
      merger.connect(this.drc);
      this.monoSplitter = splitter;
      this.monoMerger = merger;
    } else {
      this.gain.connect(this.drc);
    }
    this.drc.connect(this.analyser);
  }

  /** DRC kapalıyken zincirde kalır ama transparan davranır (rebuild gerekmez). */
  private applyDrcParams(): void {
    if (!this.ctx || !this.drc) return;
    const now = this.ctx.currentTime;
    const on = this.active && this.settings.drcEnabled;
    const c = this.drc;
    if (on) {
      c.threshold.setValueAtTime(DRC_PARAMS.threshold, now);
      c.knee.setValueAtTime(DRC_PARAMS.knee, now);
      c.ratio.setValueAtTime(DRC_PARAMS.ratio, now);
      c.attack.setValueAtTime(DRC_PARAMS.attack, now);
      c.release.setValueAtTime(DRC_PARAMS.release, now);
    } else {
      c.threshold.setValueAtTime(0, now);
      c.knee.setValueAtTime(0, now);
      c.ratio.setValueAtTime(1, now);
      c.attack.setValueAtTime(DRC_PARAMS.attack, now);
      c.release.setValueAtTime(DRC_PARAMS.release, now);
    }
  }

  private applyParams(): void {
    if (!this.ctx || !this.gain) return;
    const now = this.ctx.currentTime;
    const vol = this.active ? Math.max(0, Math.min(MAX_GAIN, this.settings.volume)) : 1;
    this.gain.gain.setTargetAtTime(vol, now, GAIN_TIME_CONSTANT);
    this.eqBands.forEach((band, i) => {
      band.gain.setTargetAtTime(this.active ? this.settings.eq[i] ?? 0 : 0, now, GAIN_TIME_CONSTANT);
    });
    this.applyDrcParams();
  }

  // -------------------------------------------------------------------------
  // Kaynak bağlama
  // -------------------------------------------------------------------------

  /** CORS taint riski: cross-origin + CORS'suz yüklenen medya, MediaElementSource'a
   * bağlanınca Firefox'ta TAMAMEN sessizleşir ve bu geri alınamaz. Riskliyse atla. */
  private isTaintRisk(el: HTMLMediaElement): boolean {
    const src = el.currentSrc || el.src;
    if (!src) return false; // src yok — srcObject yolu değerlendirilir
    if (src.startsWith('blob:') || src.startsWith('data:')) return false; // MSE → same-origin
    try {
      if (new URL(src, location.href).origin === location.origin) return false;
    } catch {
      return false;
    }
    // Cross-origin: yalnızca CORS modunda (crossOrigin set) yüklendiyse güvenli.
    return el.crossOrigin == null;
  }

  /** Bir media elementini zincire bağlar. */
  private attachElement(el: HookedElement): void {
    if (el.dataset[HOOK_FLAG] != null) return; // '1' / 'drm' / 'taint' — tekrar deneme

    const srcObj = el.srcObject;
    const hasStream = typeof MediaStream !== 'undefined' && srcObj instanceof MediaStream;

    // Henüz kaynağı yok → erken hook'lama (sonradan tainted src atanabilir).
    // 'play' event ve MutationObserver kaynak belli olunca tekrar getirir.
    if (!el.currentSrc && !el.src && !hasStream) return;

    // DRM guard — EME'li medya (Netflix vb.) Web Audio'da sessizleşir; ATLA,
    // orijinal ses korunur (boost yok ama video bozulmaz).
    if (el.mediaKeys != null) {
      el.dataset[HOOK_FLAG] = 'drm';
      this.skippedDrm++;
      this.emit();
      return;
    }

    // Katman 2 — srcObject MediaStream (WebRTC, ör. Google Meet uzak sesi).
    // Stream doğrudan bağlanır, element mute edilir (çift ses önlenir).
    if (hasStream) {
      if (this.attachStream(srcObj)) {
        el.muted = true;
        el.dataset[HOOK_FLAG] = '1';
        this.attached++;
        this.emit();
      }
      return;
    }

    // CORS taint guard — riskli elementi hook'lama, orijinal ses korunur.
    if (this.isTaintRisk(el)) {
      el.dataset[HOOK_FLAG] = 'taint';
      this.skippedCors++;
      this.emit();
      return;
    }

    // Context suspended ise (autoplay) elementi ÖLÜ context'e yönlendirmek sesi
    // tamamen keser ve geri alınamaz. Bu yüzden bağlamayı ERTELE: context çalışır
    // hale gelince (ilk etkileşim) resumeIfSuspended yeniden dener.
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      this.pendingResume = true;
      this.resumeIfSuspended();
      this.emit();
      return; // flag set ETME — resume sonrası tekrar denenecek
    }

    // Katman 1 — MediaElementSource (çıkışı yönlendirir, çift ses olmaz).
    try {
      const source = ctx.createMediaElementSource(el);
      source.connect(this.entry!);
      el.dataset[HOOK_FLAG] = '1';
      this.attached++;
      if (this.bestLayer === 'none') this.bestLayer = 'media_element';
      this.emit();
    } catch {
      /* zaten başka context'e bağlı veya desteklenmiyor */
    }
  }

  private attachStream(stream: MediaStream): boolean {
    if (this.hookedStreams.has(stream)) return true;
    if (stream.getAudioTracks().length === 0) return false;
    try {
      const source = this.ensureContext().createMediaStreamSource(stream);
      source.connect(this.entry!);
      this.hookedStreams.add(stream);
      if (this.bestLayer !== 'media_element') this.bestLayer = 'media_stream';
      return true;
    } catch {
      return false;
    }
  }

  /** Mevcut tüm media elementlerini (shadow DOM dahil) bağlar; en az biri
   *  GERÇEKTEN işlendiyse (bağlandı ya da DRM/CORS nedeniyle kesin atlandı) true.
   *  Salt DOM'da <video> bulunması yetmez — ör. YouTube'da element DOM'a
   *  eklenmiş ama henüz currentSrc/blob ataması yapılmamış olabilir; bu durumda
   *  attachElement sessizce erken çıkar ve element hook'lanmaz. Eskiden burada
   *  "media.length > 0" dönüyordu ve bu, aşağıdaki findAndAttach'ın yeniden
   *  denemesini gereksiz yere durduruyordu — element sonsuza dek askıda kalıyordu. */
  private attachAllMedia(): boolean {
    const media: HTMLMediaElement[] = [];
    collectMedia(document, media);
    media.forEach((el) => this.attachElement(el as HookedElement));
    return this.attached + this.skippedDrm + this.skippedCors > 0;
  }

  /** DOM'da henüz media yoksa üstel geri çekilme ile tekrar dener. */
  private async findAndAttach(retries = 6, delay = 600): Promise<void> {
    if (this.attachAllMedia()) return;
    if (retries <= 0) return;
    await new Promise<void>((r) => setTimeout(r, delay));
    return this.findAndAttach(retries - 1, Math.round(delay * 1.4));
  }

  private startObserving(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLMediaElement) {
            this.attachElement(node as HookedElement);
          } else if (node instanceof Element) {
            const found: HTMLMediaElement[] = [];
            collectMedia(node, found);
            found.forEach((el) => this.attachElement(el as HookedElement));
          }
        });
      }
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });

    // Oynatma/kaynak-hazır sinyalleri: erken hook denemesi currentSrc yokluğu
    // yüzünden sessizce başarısız olduysa (attachElement early-return), bu
    // event'lerden biri geldiğinde tekrar denenir. Sadece 'play'e güvenmek
    // yetersiz — MSE/blob tabanlı oynatıcılarda (YouTube gibi) src, 'play'
    // tetiklenmeden önce veya sonra farklı zamanlarda hazır olabilir.
    for (const ev of ['play', 'playing', 'loadedmetadata'] as const) {
      document.addEventListener(
        ev,
        (e) => {
          if (e.target instanceof HTMLMediaElement) {
            this.attachElement(e.target as HookedElement);
          }
        },
        true,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Genel API (content/index.ts kullanır)
  // -------------------------------------------------------------------------

  /** İşlemeyi başlat: kaynakları bağla, gözlemcileri kur, ayarı uygula. */
  start(settings: CaptureSettings): CaptureLayer {
    this.settings = { ...settings, eq: [...settings.eq] };
    this.active = true;
    this.startObserving();
    // attachElement context'i yalnızca medya bulununca ve gerekince oluşturur;
    // medyası olmayan frame'ler (reklam iframe'leri) boşuna AudioContext açmaz.
    const found = this.attachAllMedia();
    this.applyParams();
    this.applyMonoRouting();
    if (!found) void this.findAndAttach();
    this.emit();
    return this.bestLayer;
  }

  /** Canlı ayar uygula (yalnızca aktifken çağrılır). */
  update(settings: CaptureSettings): void {
    const monoChanged = settings.monoEnabled !== this.settings.monoEnabled;
    this.settings = { ...settings, eq: [...settings.eq] };
    if (!this.active) return;
    this.applyParams();
    if (monoChanged) this.applyMonoRouting();
  }

  /** Nötr geçişe dön: gain 1.0, EQ düz, DRC transparan, mono kapalı.
   * (createMediaElementSource geri alınamaz; ses orijinal seviyesine döner.) */
  stop(): void {
    this.active = false;
    if (!this.ctx) {
      this.emit();
      return;
    }
    this.applyParams();
    this.applyMonoRouting();
    this.emit();
  }

  isActive(): boolean {
    return this.active;
  }

  getLayer(): CaptureLayer {
    return this.bestLayer;
  }

  /** Motorun gerçek durumu — popup feedback'i bunu gösterir. */
  getStatus(): EngineStatus {
    const ctxRunning = this.ctx?.state === 'running';
    let state: EngineState;
    const hasSkipped = this.skippedDrm > 0 || this.skippedCors > 0;
    if (!this.active) {
      state = 'idle';
    } else if (this.attached > 0 && ctxRunning && hasSkipped) {
      // Bu frame'de bağlı kaynak var AMA atlanan başka kaynak da var —
      // ses ayarı o atlanan kaynağı etkilemez.
      state = 'partial';
    } else if (this.attached > 0 && ctxRunning) {
      state = 'active';
    } else if (this.pendingResume || this.ctx?.state === 'suspended') {
      state = 'suspended';
    } else if (this.skippedDrm > 0 && this.attached === 0) {
      state = 'blocked_drm';
    } else if (this.skippedCors > 0 && this.attached === 0) {
      state = 'blocked_cors';
    } else if (this.attached > 0) {
      state = 'active';
    } else {
      state = 'no_media';
    }
    return {
      state,
      attached: this.attached,
      mediaFound: this.attached + this.skippedDrm + this.skippedCors,
      skippedDrm: this.skippedDrm,
      skippedCors: this.skippedCors,
    };
  }

  /** VU seviyesi — offscreen.ts ile aynı hesap. */
  getLevel(): number {
    if (!this.analyser || !this.active) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += Math.abs(v - 128);
    return sum / data.length;
  }
}
