import { DeepgramClient } from "@deepgram/sdk";
import { flags } from "@/lib/flags";
import type { ToolResult } from "@/types";

// Server-side only: the browser never sees DEEPGRAM_API_KEY directly. Voice
// streaming itself happens client-side against Deepgram's WebSocket, so this
// module mints the browser's credential (doc section 9), and also serves the
// two paths that stay server-held: Aura TTS, and prerecorded transcription for
// the proxy fallback below.
export function getDeepgramClient(): DeepgramClient {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }
  return new DeepgramClient({ apiKey });
}

export async function checkDeepgramConfigured(): Promise<ToolResult<{ configured: boolean }>> {
  const started = performance.now();
  const configured = flags.useLiveDeepgram && Boolean(process.env.DEEPGRAM_API_KEY);
  return {
    ok: true,
    source: configured ? "live" : "fixture",
    data: { configured },
    latencyMs: performance.now() - started,
  };
}

// --- Shared audio contract ------------------------------------------------
// Both voice paths transcribe with the same options, so a turn produces the
// same text whether it streamed over the socket or went through the proxy.

export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_ENCODING = "linear16";
export const VOICE_MODEL = "nova-3";
export const VOICE_TTS_MODEL = "aura-2-thalia-en";

// Nova-3 keyterm boosting. The whole demo turns on the clinician hearing
// "lamotrigine" correctly, and these are the words a general model is least
// sure about.
export const VOICE_KEYTERMS = [
  "lamotrigine",
  "rash",
  "hives",
  "dermatology",
  "corticosteroid",
  "Stevens-Johnson",
];

// --- Browser credential ---------------------------------------------------

export type VoiceCredential =
  | {
      mode: "stream";
      /** WebSocket subprotocol the browser pairs with `token`. */
      authProtocol: "bearer";
      token: string;
      expiresInSeconds: number;
    }
  | { mode: "proxy"; reason: string }
  | { mode: "off"; reason: string };

/**
 * Decide how the browser reaches Deepgram for this session.
 *
 * Preferred is `stream`: a short-lived JWT the browser puts straight on the
 * listen socket, so audio never round-trips through us. Minting one requires an
 * API key with Member or higher authorization — ours does not have it yet and
 * returns 403 — so we degrade to `proxy`, where the key stays on the server and
 * the browser posts finished utterances to /api/voice/transcribe instead.
 *
 * Nothing else branches on this. The moment the key is upgraded this starts
 * returning `stream` and the client switches over with no code change.
 */
export async function grantVoiceCredential(): Promise<VoiceCredential> {
  if (!flags.useLiveDeepgram) {
    return { mode: "off", reason: "USE_LIVE_DEEPGRAM is false" };
  }
  if (!process.env.DEEPGRAM_API_KEY) {
    return { mode: "off", reason: "DEEPGRAM_API_KEY is not configured" };
  }

  try {
    // 300s covers a full intake without re-minting mid-conversation.
    const grant = await getDeepgramClient().auth.v1.tokens.grant({ ttl_seconds: 300 });
    return {
      mode: "stream",
      authProtocol: "bearer",
      token: grant.access_token,
      expiresInSeconds: grant.expires_in ?? 30,
    };
  } catch (error) {
    // Recoverable by definition — the proxy path needs no browser credential at
    // all — so never fail the session over it.
    return {
      mode: "proxy",
      reason: error instanceof Error ? error.message : "token grant failed",
    };
  }
}

// --- Proxy-path transcription --------------------------------------------

/** Transcribe one finished utterance of raw linear16 PCM. */
export async function transcribeUtterance(
  audio: ArrayBuffer,
  sampleRate: number
): Promise<ToolResult<{ transcript: string }>> {
  const started = performance.now();

  try {
    const response = await getDeepgramClient().listen.v1.media.transcribeFile(
      new Uint8Array(audio),
      {
        model: VOICE_MODEL,
        encoding: VOICE_ENCODING,
        smart_format: true,
        punctuate: true,
        keyterm: VOICE_KEYTERMS,
      },
      // Raw linear16 carries no container, so Deepgram has to be told the rate
      // and channel count. The SDK's typed request omits both, so they go on
      // the query string directly.
      { queryParams: { sample_rate: sampleRate, channels: 1 } }
    );

    // The response type also covers the async-callback shape, which has no
    // results at all.
    const transcript =
      ("results" in response
        ? response.results?.channels?.[0]?.alternatives?.[0]?.transcript
        : ""
      )?.trim() ?? "";

    return {
      ok: true,
      source: "live",
      data: { transcript },
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      source: "live",
      error: error instanceof Error ? error.message : "transcription failed",
      latencyMs: performance.now() - started,
    };
  }
}

// --- Spoken replies -------------------------------------------------------

/** Render agent copy to speech. Returns mp3 bytes for direct browser playback. */
export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const audio = await getDeepgramClient().speak.v1.audio.generate({
    text,
    model: VOICE_TTS_MODEL,
    encoding: "mp3",
  });
  return audio.arrayBuffer();
}
