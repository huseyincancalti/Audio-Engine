// src/offscreen/offscreen.ts
// v5.0 ses motoru. Her sekme için tabCapture stream'ini alıp Web Audio ile işler.
// Background'dan `target:'offscreen'` mesajları gelir. esbuild IIFE olarak derlenir.
//
// Zincir: source → EQ(seri) → gain → [mono?] → [drc?] → analyser → destination

import {
  MessageType,
  EQ_FREQUENCIES,
  GAIN_TIME_CONSTANT,
  DRC_PARAMS,
  OFFSCREEN_TARGET,
  type CaptureSettings,
  type OffscreenMsg,
  type LevelResponse,
  type IsCapturingResponse,
} from '../types/index';

interface TabEngine {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  eqBands: BiquadFilterNode[];
  gain: GainNode;
  drc: DynamicsCompressorNode;
  splitter: ChannelSplitterNode | null;
  merger: ChannelMergerNode | null;
  analyser: AnalyserNode;
  stream: MediaStream;
  monoEnabled: boolean;
  drcEnabled: boolean;
}

const engines = new Map<number, TabEngine>();

// ---------------------------------------------------------------------------
// Mesaj yönlendirme
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const msg = raw as Partial<OffscreenMsg> | undefined;
  if (!msg || msg.target !== OFFSCREEN_TARGET) return false;

  switch (msg.type) {
    case 'START_CAPTURE':
      void startCapture(msg.tabId!, msg.streamId!, msg.settings!);
      return false;
    case 'UPDATE_SETTINGS':
      updateSettings(msg.tabId!, msg.settings!);
      return false;
    case 'STOP_CAPTURE':
      stopCapture(msg.tabId!);
      return false;
    case 'GET_LEVEL': {
      const res: LevelResponse = { level: getLevel(msg.tabId!) };
      sendResponse(res);
      return true; // async kanal — sendResponse kullandık
    }
    case 'IS_CAPTURING': {
      // Background SW yeniden başladığında RAM'deki yakalama seti boşalır;
      // gerçek durumu (engine var mı?) buradan sorar.
      const res: IsCapturingResponse = { capturing: engines.has(msg.tabId!) };
      sendResponse(res);
      return true;
    }
    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Zincir kurulumu
// ---------------------------------------------------------------------------

/** EQ → gain → [mono?] → [drc?] → analyser → destination yolunu (yeniden) bağlar. */
function buildChain(e: TabEngine): void {
  const { ctx } = e;

  // source → EQ(seri)
  e.source.connect(e.eqBands[0]!);
  for (let i = 0; i < e.eqBands.length - 1; i++) {
    e.eqBands[i]!.connect(e.eqBands[i + 1]!);
  }
  let node: AudioNode = e.eqBands[e.eqBands.length - 1]!;

  // → gain
  node.connect(e.gain);
  node = e.gain;

  // → [mono?]  (L+R'yi tek kanala topla, sonra her iki çıkışa yay)
  if (e.monoEnabled) {
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(1);
    node.connect(splitter);
    splitter.connect(merger, 0, 0); // L → mono
    splitter.connect(merger, 1, 0); // R → mono
    e.splitter = splitter;
    e.merger = merger;
    node = merger;
  } else {
    e.splitter = null;
    e.merger = null;
  }

  // → [drc?]
  if (e.drcEnabled) {
    node.connect(e.drc);
    node = e.drc;
  }

  // → analyser → destination
  node.connect(e.analyser);
  e.analyser.connect(ctx.destination);
}

/** Tüm grafiği söküp güncel mono/drc bayraklarıyla yeniden bağlar. */
function rebuildChain(e: TabEngine): void {
  e.source.disconnect();
  e.eqBands.forEach((b) => b.disconnect());
  e.gain.disconnect();
  e.drc.disconnect();
  e.splitter?.disconnect();
  e.merger?.disconnect();
  e.analyser.disconnect();
  buildChain(e);
}

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------

async function startCapture(
  tabId: number,
  streamId: string,
  settings: CaptureSettings,
): Promise<void> {
  if (engines.has(tabId)) return; // zaten yakalanıyor

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      },
      video: false,
    } as unknown as MediaStreamConstraints);
  } catch (err) {
    console.error('[offscreen] getUserMedia başarısız:', err);
    return;
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  const ctx = new AudioContext();
  // Offscreen'de kullanıcı jesti yok; context running olmazsa ses akmaz.
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      /* offscreen normalde resume gerektirmez */
    }
  }

  const source = ctx.createMediaStreamSource(stream);

  const eqBands = EQ_FREQUENCIES.map((freq) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking';
    b.frequency.value = freq;
    b.Q.value = 1;
    b.gain.value = 0;
    return b;
  });

  const gain = ctx.createGain();
  gain.gain.value = settings.volume;

  const drc = ctx.createDynamicsCompressor();
  drc.threshold.value = DRC_PARAMS.threshold;
  drc.knee.value = DRC_PARAMS.knee;
  drc.ratio.value = DRC_PARAMS.ratio;
  drc.attack.value = DRC_PARAMS.attack;
  drc.release.value = DRC_PARAMS.release;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 32;

  const engine: TabEngine = {
    ctx,
    source,
    eqBands,
    gain,
    drc,
    splitter: null,
    merger: null,
    analyser,
    stream,
    monoEnabled: settings.monoEnabled,
    drcEnabled: settings.drcEnabled,
  };

  buildChain(engine);
  applyParams(engine, settings);
  engines.set(tabId, engine);

  // Sekme kapanınca / navigasyonda stream biter → temizle + background'a haber ver.
  stream.getAudioTracks()[0]!.onended = () => {
    stopCapture(tabId);
    chrome.runtime.sendMessage({ type: MessageType.CAPTURE_ENDED, payload: { tabId } }).catch(() => {
      /* background uykuda olabilir */
    });
  };
}

/** volume + eq'yu yumuşak rampa ile uygular (zincir değişimi yok). */
function applyParams(e: TabEngine, s: CaptureSettings): void {
  const now = e.ctx.currentTime;
  e.gain.gain.setTargetAtTime(s.volume, now, GAIN_TIME_CONSTANT);
  e.eqBands.forEach((band, i) => {
    band.gain.setTargetAtTime(s.eq[i] ?? 0, now, GAIN_TIME_CONSTANT);
  });
}

function updateSettings(tabId: number, settings: CaptureSettings): void {
  const e = engines.get(tabId);
  if (!e) return;

  applyParams(e, settings);

  // mono/drc değişimi zincir yeniden bağlama gerektirir.
  if (settings.monoEnabled !== e.monoEnabled || settings.drcEnabled !== e.drcEnabled) {
    e.monoEnabled = settings.monoEnabled;
    e.drcEnabled = settings.drcEnabled;
    rebuildChain(e);
  }
}

function getLevel(tabId: number): number {
  const e = engines.get(tabId);
  if (!e) return 0;
  const data = new Uint8Array(e.analyser.frequencyBinCount);
  e.analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += Math.abs(v - 128);
  return sum / data.length;
}

function stopCapture(tabId: number): void {
  const e = engines.get(tabId);
  if (!e) return;
  e.stream.getTracks().forEach((t) => t.stop());
  void e.ctx.close().catch(() => {
    /* zaten kapalı */
  });
  engines.delete(tabId);
}
