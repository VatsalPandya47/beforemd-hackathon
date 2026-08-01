import { NextRequest, NextResponse } from "next/server";
import { transcribeUtterance, VOICE_SAMPLE_RATE } from "@/lib/integrations/deepgram";

// Proxy path (see grantVoiceCredential): the browser cannot hold a Deepgram
// credential, so it posts one finished utterance of raw linear16 PCM here and
// we transcribe it with the server-held key. Body is raw audio, not JSON.
//
// A capped 30s utterance at 16kHz mono is ~960KB, well inside the platform
// body limit.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const sampleRateParam = request.nextUrl.searchParams.get("sampleRate");
  const sampleRate = Number(sampleRateParam ?? VOICE_SAMPLE_RATE);

  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    return NextResponse.json({ error: "Invalid sampleRate" }, { status: 400 });
  }

  const audio = await request.arrayBuffer();

  if (audio.byteLength === 0) {
    return NextResponse.json({ error: "Empty audio body" }, { status: 400 });
  }
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }

  const result = await transcribeUtterance(audio, sampleRate);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    transcript: result.data?.transcript ?? "",
    latencyMs: Math.round(result.latencyMs),
  });
}
