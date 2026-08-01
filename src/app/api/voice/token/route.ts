import { NextResponse } from "next/server";
import {
  grantVoiceCredential,
  VOICE_KEYTERMS,
  VOICE_MODEL,
  VOICE_SAMPLE_RATE,
} from "@/lib/integrations/deepgram";

// The browser asks here once per session: how do I reach Deepgram, and with
// what audio settings. Returning the settings alongside the credential keeps
// the streaming and proxy paths transcribing identically (doc section 9).
export async function POST() {
  const credential = await grantVoiceCredential();

  return NextResponse.json(
    {
      credential,
      audio: {
        sampleRate: VOICE_SAMPLE_RATE,
        model: VOICE_MODEL,
        keyterms: VOICE_KEYTERMS,
      },
    },
    // Never cached: a stream token is short-lived and the mode can change
    // between sessions once the key is upgraded.
    { headers: { "Cache-Control": "no-store" } }
  );
}
