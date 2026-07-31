import { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

const ReplaySchema = z.object({ sessionId: z.string().uuid() });

// Fallback ladder entry (doc section 10): streams the committed transcript
// and agent events for a session verbatim, so the demo can recover if the
// live voice/agent path fails mid-run.
export async function POST(request: NextRequest) {
  const parsed = ReplaySchema.safeParse(await request.json());
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }
  const { sessionId } = parsed.data;

  const supabase = createAdminClient();
  const { data: events, error } = await supabase
    .from("transcript_events")
    .select("speaker, text, sequence_no, created_at")
    .eq("session_id", sessionId)
    .order("sequence_no", { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const event of events ?? []) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
