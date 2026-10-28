import  "server-only";
import {StreamClient} from "@stream-io/node-sdk";

// The SDK's default 3 s timeout made the kill-switch's call.end() fail on a slow connection
export const STREAM_TIMEOUT_MS = 15_000;

export const streamVideo = new StreamClient(
    process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
    process.env.STREAM_VIDEO_SECRET_KEY!,
    { timeout: STREAM_TIMEOUT_MS }
);
