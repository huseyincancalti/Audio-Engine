// src/content/injected.ts
// Katman 3 — WebRTC ses yakalama. MAIN world'de çalışır (manifest world: MAIN).
// RTCPeerConnection'ı wrap'ler, uzaktan gelen ses stream'lerini AudioEngine'e
// verir ve orijinal <audio>/<video> playback'ini susturarak çift sesi önler.
// chrome API'si KULLANMAZ — content ile window.postMessage üzerinden konuşur.
// ARCHITECTURE.md bölüm 5.3, 5.4.

import { AudioEngine } from '../core/audio/AudioEngine';
import {
  RTC_TRACK_EVENT,
  RTC_RESET_EVENT,
  RTC_CONTROL_EVENT,
  type RtcTrackMessage,
  type RtcControlMessage,
} from '../types/index';

interface PatchableWindow extends Window {
  __audioEngineRTCHooked?: boolean;
  RTCPeerConnection: typeof RTCPeerConnection;
  webkitRTCPeerConnection?: typeof RTCPeerConnection;
}

(function installRtcHook(): void {
  const w = window as PatchableWindow;

  // Tekrar hook'lamayı engelle (ARCHITECTURE bölüm 5.4).
  if (w.__audioEngineRTCHooked) return;
  w.__audioEngineRTCHooked = true;

  const engine = new AudioEngine();
  const processed = new WeakSet<MediaStream>();
  const pending = new Set<MediaStream>();
  let boostedCount = 0;
  // Routing/mute YALNIZCA content boost'u etkinleştirince başlar (RTC_CONTROL).
  // Kural yoksa content sinyal göndermez → sayfa sesi hiç değişmez (lazy activation).
  let active = false;

  function notify(): void {
    const msg: RtcTrackMessage = { source: RTC_TRACK_EVENT, streamCount: boostedCount + pending.size };
    window.postMessage(msg, '*');
  }

  /** stream'i çalan bir media elementi bul (uzak ses elemente bağlıdır; yerel mic değildir). */
  function findElementFor(stream: MediaStream): HTMLMediaElement | null {
    const list = document.querySelectorAll<HTMLMediaElement>('video, audio');
    for (const el of Array.from(list)) {
      if ((el as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject === stream) {
        return el;
      }
    }
    return null;
  }

  /** Yeni ses stream'i TESPİT et: kuyruğa al, content'e haber ver, etkinse hemen boost et. */
  function detect(stream: MediaStream | null | undefined): void {
    if (!stream || processed.has(stream) || pending.has(stream)) return;
    if (stream.getAudioTracks().length === 0) return;
    pending.add(stream);
    notify();
    if (active) flushStream(stream);
  }

  /**
   * Bir stream'i boost zincirine al. Sadece bir media elementi ÇALIYORSA işler
   * (yerel mikrofon stream'i eleman olmadığından atlanır → echo yok). Eleman
   * henüz yoksa kısa süre tekrar dener.
   */
  function flushStream(stream: MediaStream, attempt = 0): void {
    if (!active || processed.has(stream) || !pending.has(stream)) return;
    const el = findElementFor(stream);
    if (el) {
      void engine.attachToSource(stream).then((layer) => {
        if (!pending.has(stream)) return;
        if (layer !== 'bypass') {
          pending.delete(stream);
          processed.add(stream);
          el.muted = true; // orijinal playback'i sustur → boost'lu sesi biz veriyoruz
          boostedCount++;
          console.info('[injected] WebRTC ses boost zincirine alındı (Katman 3)');
          notify();
        }
      });
      return;
    }
    if (attempt < 6) window.setTimeout(() => flushStream(stream, attempt + 1), 400);
  }

  function flushAll(): void {
    for (const stream of Array.from(pending)) flushStream(stream);
  }

  // --- Content'ten gelen mesajlar ---
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const raw = event.data as Record<string, unknown> | undefined;
    if (!raw || typeof raw.source !== 'string') return;

    // SPA navigasyon reset: active flag'ini sıfırla, yeni sayfada sıfırdan başla
    if (raw.source === RTC_RESET_EVENT) {
      active = false;
      boostedCount = 0;
      return;
    }

    if (raw.source !== RTC_CONTROL_EVENT) return;
    const d = raw as unknown as Partial<RtcControlMessage>;
    active = true;
    engine.setVolume(d.volume ?? 1);
    engine.setEq(d.eq ?? []);
    engine.setDrcEnabled(d.drcEnabled ?? true);
    engine.setPower(d.power ?? true);
    // AudioContext suspended ise hemen resume et (WebRTC sesi değişmeme sorunu)
    engine.tryResume();
    flushAll();
  });

  // --- RTCPeerConnection.prototype.addTrack wrap (ARCHITECTURE bölüm 5.2) ---
  try {
    const proto = RTCPeerConnection.prototype;
    const origAddTrack = proto.addTrack;
    proto.addTrack = function (
      this: RTCPeerConnection,
      track: MediaStreamTrack,
      ...streams: MediaStream[]
    ): RTCRtpSender {
      try {
        if (track && track.kind === 'audio') streams.forEach((s) => detect(s));
      } catch {
        /* sayfayı bozma */
      }
      return origAddTrack.apply(this, [track, ...streams]);
    };
  } catch {
    /* ignore */
  }

  // --- RTCPeerConnection.prototype.addStream wrap (deprecated ama spec'te) ---
  try {
    const proto = RTCPeerConnection.prototype as unknown as {
      addStream?: (this: RTCPeerConnection, stream: MediaStream) => void;
    };
    if (typeof proto.addStream === 'function') {
      const origAddStream = proto.addStream;
      proto.addStream = function (this: RTCPeerConnection, stream: MediaStream): void {
        try {
          detect(stream);
        } catch {
          /* ignore */
        }
        return origAddStream.apply(this, [stream]);
      };
    }
  } catch {
    /* ignore */
  }

  // --- Gelen uzak ses: constructor'ı sarıp 'track' olayını dinle (asıl boost yolu) ---
  try {
    const Orig = w.RTCPeerConnection;
    if (Orig) {
      const Patched = function (this: unknown, ...args: unknown[]): RTCPeerConnection {
        const pc = new (Orig as unknown as new (...a: unknown[]) => RTCPeerConnection)(...args);
        try {
          pc.addEventListener('track', (ev: RTCTrackEvent) => {
            try {
              if (ev.track && ev.track.kind === 'audio') {
                const streams =
                  ev.streams && ev.streams.length ? ev.streams : [new MediaStream([ev.track])];
                streams.forEach((s) => detect(s));
              }
            } catch {
              /* ignore */
            }
          });
        } catch {
          /* ignore */
        }
        return pc;
      } as unknown as typeof RTCPeerConnection;

      Patched.prototype = Orig.prototype;
      Object.setPrototypeOf(Patched, Orig); // statik üyeleri koru (generateCertificate vb.)
      w.RTCPeerConnection = Patched;
      if (w.webkitRTCPeerConnection) w.webkitRTCPeerConnection = Patched;
    }
  } catch {
    /* ignore */
  }

  console.info('[injected] Audio Engine WebRTC hook kuruldu (MAIN world)');
})();
