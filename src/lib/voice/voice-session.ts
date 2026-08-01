// Live patient voice for the intake screen (issue #15, doc section 9).
//
// One mic pipeline, two ways out:
//
//   stream — chunks go straight to Deepgram's listen socket and turns end on
//            Deepgram's own endpointing, so words appear while the patient is
//            still talking.
//   proxy  — the browser has no Deepgram credential, so chunks are buffered
//            locally, a silence detector ends the turn, and the finished
//            utterance is posted to /api/voice/transcribe.
//
// /api/voice/token picks the mode; see grantVoiceCredential() for why proxy
// exists. Both produce the same thing — a final utterance string — so nothing
// downstream of onUtterance knows which one ran. If the socket drops
// mid-session the engine degrades to proxy in place rather than ending the
// session, which is the "Deepgram connection fails" row of the fallback ladder.

export type VoiceMode = "stream" | "proxy";

export type VoicePhase =
  | "idle" // not started
  | "starting" // asking for the mic, opening the socket
  | "listening" // mic live
  | "processing" // turn ended, transcribing
  | "paused" // mic suspended while the agent speaks
  | "error";

export type VoiceSessionCallbacks = {
  onPhase?: (phase: VoicePhase) => void;
  /** Partial words while the patient is still speaking. Stream mode only. */
  onInterim?: (text: string) => void;
  /** A finished patient turn. */
  onUtterance?: (text: string) => void;
  /** Mic level, 0..1, roughly 15x/second. */
  onLevel?: (level: number) => void;
  onMode?: (mode: VoiceMode, reason: string) => void;
  onError?: (message: string) => void;
};

export type VoiceStartResult = { ok: true; mode: VoiceMode } | { ok: false; reason: string };

// --- Turn detection tuning ------------------------------------------------
// Only used on the proxy path; stream mode uses Deepgram's endpointing.

/**
 * Silence that ends a turn. 800ms tested too eager — real speakers pause
 * mid-sentence to think, and because the mic mutes while the agent replies,
 * an early cut does not just split the sentence, it loses the rest of it.
 */
const SILENCE_MS = 1200;
/** Ignore blips shorter than this so a cough is not a turn. */
const MIN_VOICED_MS = 250;
/** Hard cap on one utterance, keeps the POST body bounded. */
const MAX_UTTERANCE_MS = 30_000;
/** Audio kept before speech is detected, so the first syllable is not clipped. */
const PREROLL_MS = 320;
/** Floor for the speech threshold, whatever the room noise measures. */
const MIN_SPEECH_RMS = 0.015;
/** Room noise is sampled for this long at start, then multiplied. */
const NOISE_SAMPLE_MS = 400;
const NOISE_MULTIPLIER = 3;

const WORKLET_URL = "/voice-capture-worklet.js";
const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";
const KEEPALIVE_MS = 5000;

type TokenResponse = {
  credential:
    | { mode: "stream"; authProtocol: "bearer"; token: string; expiresInSeconds: number }
    | { mode: "proxy"; reason: string }
    | { mode: "off"; reason: string };
  audio: { sampleRate: number; model: string; keyterms: string[] };
};

export class VoiceSession {
  private readonly callbacks: VoiceSessionCallbacks;

  private phase: VoicePhase = "idle";
  private mode: VoiceMode = "proxy";
  private stopped = true;
  /** Mic input is ignored while true (the agent is speaking). */
  private muted = false;

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private socket: WebSocket | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  // Replies play through an <audio> element rather than the capture graph, so
  // Aura's 24kHz output is not resampled down to the 16kHz mic context.
  private playback: HTMLAudioElement | null = null;
  private playbackUrl: string | null = null;

  private sampleRate = 16000;
  private model = "nova-3";
  private keyterms: string[] = [];

  // Stream-mode transcript assembly.
  private finalizedText = "";

  // Proxy-mode capture state.
  private preroll: Int16Array[] = [];
  private prerollFrames = 0;
  private captured: Int16Array[] = [];
  private capturedFrames = 0;
  private voiced = false;
  private voicedFrames = 0;
  private silentFrames = 0;
  private speechThreshold = MIN_SPEECH_RMS;
  private noiseFrames = 0;
  private noiseSum = 0;

  constructor(callbacks: VoiceSessionCallbacks = {}) {
    this.callbacks = callbacks;
  }

  getPhase(): VoicePhase {
    return this.phase;
  }

  getMode(): VoiceMode {
    return this.mode;
  }

  async start(): Promise<VoiceStartResult> {
    if (!this.stopped) return { ok: true, mode: this.mode };
    this.stopped = false;
    this.setPhase("starting");

    let config: TokenResponse;
    try {
      const response = await fetch("/api/voice/token", { method: "POST" });
      if (!response.ok) throw new Error(`token route returned ${response.status}`);
      config = (await response.json()) as TokenResponse;
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : "Could not reach the voice service");
    }

    const credential = config.credential;
    if (credential.mode === "off") {
      return this.fail(`Voice is unavailable: ${credential.reason}`);
    }

    this.model = config.audio.model;
    this.keyterms = config.audio.keyterms;
    this.mode = credential.mode;
    this.callbacks.onMode?.(
      credential.mode,
      credential.mode === "stream" ? "streaming to Deepgram" : credential.reason
    );

    try {
      await this.openMicrophone(config.audio.sampleRate);
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      return this.fail(
        denied
          ? "Microphone permission was denied"
          : error instanceof Error
            ? error.message
            : "Could not open the microphone"
      );
    }

    if (credential.mode === "stream") {
      try {
        await this.openSocket(credential.authProtocol, credential.token);
      } catch {
        // The mic is already live, so fall through on the proxy path rather
        // than failing the session.
        this.mode = "proxy";
        this.callbacks.onMode?.("proxy", "Deepgram socket did not open");
      }
    }

    if (this.stopped) return { ok: false, reason: "stopped" };
    this.setPhase("listening");
    return { ok: true, mode: this.mode };
  }

  stop() {
    this.stopped = true;
    this.stopPlayback();

    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      // Drop the handlers first so teardown does not look like a drop-out.
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
      }
      socket.close();
    }
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;

    this.resetCapture();
    this.setPhase("idle");
  }

  /** Stop listening without tearing anything down (the agent is talking). */
  pause() {
    if (this.muted) return;
    this.muted = true;
    this.resetCapture();
    if (this.phase === "listening") this.setPhase("paused");
  }

  resume() {
    if (!this.muted) return;
    this.muted = false;
    this.resetCapture();
    if (this.phase === "paused") this.setPhase("listening");
  }

  /**
   * Speak agent copy through Aura, with the mic muted so the agent does not
   * transcribe itself. Resolves when playback finishes — or immediately, if
   * TTS is unavailable, in which case the caller still has the reply on screen.
   */
  async speak(text: string): Promise<void> {
    if (this.stopped) return;
    this.pause();

    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`speak route returned ${response.status}`);

      const blob = await response.blob();
      if (this.stopped) return;

      await new Promise<void>((resolve) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.playback = audio;
        this.playbackUrl = url;

        // Resolve on any terminal outcome — a reply that will not play must
        // not strand the turn, since the text is already on screen.
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
    } catch {
      // Silent by design: a missing voice is a degraded demo, not a broken one.
    } finally {
      this.stopPlayback();
      this.resume();
    }
  }

  /** Cut the agent off mid-sentence (used when the patient takes over). */
  stopPlayback() {
    const audio = this.playback;
    this.playback = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (this.playbackUrl) {
      URL.revokeObjectURL(this.playbackUrl);
      this.playbackUrl = null;
    }
  }

  // --- Setup --------------------------------------------------------------

  private async openMicrophone(preferredSampleRate: number) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Chrome and Safari both honour an explicit rate here, which saves
    // resampling; we read back the real rate anyway and tell Deepgram that,
    // so a browser that ignores it still transcribes correctly.
    this.context = new AudioContext({ sampleRate: preferredSampleRate });
    if (this.context.state === "suspended") await this.context.resume();
    this.sampleRate = this.context.sampleRate;

    await this.context.audioWorklet.addModule(WORKLET_URL);
    if (this.stopped) return;

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "voice-capture");
    this.node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      this.onAudioChunk(new Int16Array(event.data.pcm), event.data.rms);
    };
    this.source.connect(this.node);
    // Worklet nodes need a sink to be pulled, but the patient must not hear
    // themselves, so terminate into a muted gain rather than the speakers.
    const sink = this.context.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.context.destination);
  }

  private openSocket(authProtocol: string, token: string): Promise<void> {
    const params = new URLSearchParams({
      model: this.model,
      encoding: "linear16",
      sample_rate: String(this.sampleRate),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    for (const keyterm of this.keyterms) params.append("keyterm", keyterm);

    // Subprotocol auth, because a browser WebSocket cannot set headers.
    const socket = new WebSocket(`${DEEPGRAM_LISTEN_URL}?${params}`, [authProtocol, token]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("socket timed out")), 6000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.keepAlive = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, KEEPALIVE_MS);
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("socket error"));
      };

      socket.onmessage = (event) => this.onSocketMessage(event);
      socket.onclose = () => this.onSocketClose();
    });
  }

  // --- Audio ---------------------------------------------------------------

  private onAudioChunk(pcm: Int16Array, rms: number) {
    if (this.stopped) return;

    this.callbacks.onLevel?.(Math.min(1, rms * 8));

    if (this.muted) return;

    if (this.mode === "stream" && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(pcm.buffer as ArrayBuffer);
    }

    // The proxy path needs this; stream mode keeps it running too so a
    // mid-session socket drop can be picked up without losing the turn.
    this.trackUtterance(pcm, rms);
  }

  private trackUtterance(pcm: Int16Array, rms: number) {
    const chunkMs = (pcm.length / this.sampleRate) * 1000;

    // Calibrate against the room for the first fraction of a second.
    if (this.noiseFrames * chunkMs < NOISE_SAMPLE_MS) {
      this.noiseFrames += 1;
      this.noiseSum += rms;
      this.speechThreshold = Math.max(
        MIN_SPEECH_RMS,
        (this.noiseSum / this.noiseFrames) * NOISE_MULTIPLIER
      );
      return;
    }

    const isVoice = rms > this.speechThreshold;

    if (!this.voiced) {
      // Hold a short pre-roll so the utterance does not start clipped.
      this.preroll.push(pcm);
      this.prerollFrames += pcm.length;
      while ((this.prerollFrames / this.sampleRate) * 1000 > PREROLL_MS && this.preroll.length > 1) {
        this.prerollFrames -= this.preroll.shift()!.length;
      }

      if (isVoice) {
        this.voiced = true;
        this.voicedFrames = pcm.length;
        this.silentFrames = 0;
        this.captured = [...this.preroll];
        this.capturedFrames = this.prerollFrames;
        this.preroll = [];
        this.prerollFrames = 0;
      }
      return;
    }

    this.captured.push(pcm);
    this.capturedFrames += pcm.length;

    if (isVoice) {
      this.voicedFrames += pcm.length;
      this.silentFrames = 0;
    } else {
      this.silentFrames += pcm.length;
    }

    const silenceMs = (this.silentFrames / this.sampleRate) * 1000;
    const totalMs = (this.capturedFrames / this.sampleRate) * 1000;
    const voicedMs = (this.voicedFrames / this.sampleRate) * 1000;

    if (silenceMs >= SILENCE_MS || totalMs >= MAX_UTTERANCE_MS) {
      const audio = voicedMs >= MIN_VOICED_MS ? this.concatCaptured() : null;
      this.resetCapture();
      // Stream mode ends turns on Deepgram's endpointing instead.
      if (audio && this.mode === "proxy") void this.transcribeCaptured(audio);
    }
  }

  private concatCaptured(): Int16Array {
    const audio = new Int16Array(this.capturedFrames);
    let offset = 0;
    for (const chunk of this.captured) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  }

  private async transcribeCaptured(audio: Int16Array) {
    this.setPhase("processing");
    try {
      const response = await fetch(`/api/voice/transcribe?sampleRate=${this.sampleRate}`, {
        method: "POST",
        headers: { "Content-Type": `audio/l16;rate=${this.sampleRate}` },
        body: audio.buffer as ArrayBuffer,
      });
      if (!response.ok) throw new Error(`transcribe returned ${response.status}`);

      const { transcript } = (await response.json()) as { transcript: string };
      if (this.stopped) return;
      if (transcript.trim()) {
        this.callbacks.onUtterance?.(transcript.trim());
      }
    } catch (error) {
      this.callbacks.onError?.(
        error instanceof Error ? error.message : "Could not transcribe that"
      );
    } finally {
      if (!this.stopped && !this.muted) this.setPhase("listening");
    }
  }

  private resetCapture() {
    this.preroll = [];
    this.prerollFrames = 0;
    this.captured = [];
    this.capturedFrames = 0;
    this.voiced = false;
    this.voicedFrames = 0;
    this.silentFrames = 0;
  }

  // --- Socket --------------------------------------------------------------

  private onSocketMessage(event: MessageEvent) {
    if (typeof event.data !== "string") return;

    let message: {
      type?: string;
      is_final?: boolean;
      speech_final?: boolean;
      channel?: { alternatives?: { transcript?: string }[] };
    };
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "Results") {
      const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";

      if (message.is_final) {
        if (transcript) {
          this.finalizedText = `${this.finalizedText} ${transcript}`.trim();
        }
        if (message.speech_final) this.commitStreamedTurn();
      } else if (transcript) {
        this.callbacks.onInterim?.(`${this.finalizedText} ${transcript}`.trim());
      }
      return;
    }

    // Backstop: endpointing did not fire but Deepgram saw the utterance end.
    if (message.type === "UtteranceEnd") this.commitStreamedTurn();
  }

  private commitStreamedTurn() {
    const text = this.finalizedText.trim();
    this.finalizedText = "";
    if (!text) return;
    this.resetCapture();
    this.callbacks.onInterim?.("");
    this.callbacks.onUtterance?.(text);
  }

  private onSocketClose() {
    if (this.stopped || this.mode !== "stream") return;
    // Degrade in place: the mic is still live, so keep the session going on
    // the proxy path instead of dropping the patient mid-sentence.
    this.socket = null;
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    this.mode = "proxy";
    this.finalizedText = "";
    this.resetCapture();
    this.callbacks.onInterim?.("");
    this.callbacks.onMode?.("proxy", "Deepgram stream dropped, switched to server transcription");
  }

  // --- Plumbing ------------------------------------------------------------

  private setPhase(phase: VoicePhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.callbacks.onPhase?.(phase);
  }

  private fail(reason: string): VoiceStartResult {
    this.stop();
    this.setPhase("error");
    this.callbacks.onError?.(reason);
    return { ok: false, reason };
  }
}
