// Mic capture for the patient intake screen.
//
// Deepgram wants linear16 PCM, and the Web Audio graph gives us float32 in
// 128-frame blocks, so this converts and batches them into ~64ms chunks. It
// also reports per-chunk RMS, which drives both the orb's reactivity and the
// silence detection that ends a turn on the proxy path.
//
// Loaded by src/lib/voice/voice-session.ts via audioWorklet.addModule().

const CHUNK_FRAMES = 1024;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(CHUNK_FRAMES);
    this.offset = 0;
    this.sumSquares = 0;
  }

  flush() {
    const rms = Math.sqrt(this.sumSquares / this.offset);
    const chunk = this.buffer.slice(0, this.offset);
    // Transfer rather than copy — this runs on the audio thread.
    this.port.postMessage({ pcm: chunk.buffer, rms }, [chunk.buffer]);
    this.offset = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input connected yet (or the track ended); keep the processor alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.sumSquares += sample * sample;
      this.buffer[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.offset += 1;
      if (this.offset === CHUNK_FRAMES) {
        this.flush();
      }
    }

    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
