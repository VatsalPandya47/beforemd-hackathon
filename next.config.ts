import type { NextConfig } from "next";

// @huggingface/transformers (used by @inferedge/moss for on-device embeddings)
// dynamically dlopen()s onnxruntime-node's shared libraries at runtime. Next's
// file tracer only follows static requires, so it bundles the .node addon but
// misses libonnxruntime.so.1 next to it — that crashed every production
// RETRIEVE_SUPPORTING_CONTEXT turn with "cannot open shared object file"
// even though local dev (same native path, no tracer) worked fine.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // linux/x64 only — Vercel Functions run on x86_64 with no arm64 option
    // exposed anywhere in this project's config, so the arm64 binaries
    // (~35MB) were dead weight against the 250MB function package limit.
    "/api/agent/turn": ["./node_modules/onnxruntime-node/bin/napi-v3/linux/x64/**/*"],
  },
};

export default nextConfig;
