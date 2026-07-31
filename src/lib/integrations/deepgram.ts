import { DeepgramClient } from "@deepgram/sdk";
import { flags } from "@/lib/flags";
import type { ToolResult } from "@/types";

// Server-side only: the browser never sees DEEPGRAM_API_KEY directly. Voice
// streaming itself happens client-side against Deepgram's Voice Agent
// WebSocket (Thang's ticket, doc section 9) — this client is for any
// server-initiated Deepgram calls (e.g. Aura TTS for scripted fallback audio).
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
