import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { flags } from "@/lib/flags";
import { synthesizeSpeech } from "@/lib/integrations/deepgram";

const SpeakSchema = z.object({
  // Agent replies are a couple of sentences; the cap is a guard, not a limit
  // anything real should hit.
  text: z.string().min(1).max(1000),
});

// Aura TTS for the agent's spoken reply. Stays server-side because it uses the
// API key directly. Returns mp3 the browser can decode and play as-is.
export async function POST(request: NextRequest) {
  const parsed = SpeakSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!flags.useLiveDeepgram || !process.env.DEEPGRAM_API_KEY) {
    // Not an error: the caller falls back to showing the reply as text only.
    return NextResponse.json({ error: "Deepgram is not configured" }, { status: 503 });
  }

  try {
    const audio = await synthesizeSpeech(parsed.data.text);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "speech synthesis failed" },
      { status: 502 }
    );
  }
}
