import "server-only"
import {StreamChat} from "stream-chat";

export const streamChat = StreamChat.getInstance(
    process.env.NEXT_PUBLIC_STREAM_CHAT_API_KEY!,
    process.env.STREAM_CHAT_SECRET_KEY!,
    // Short default timeouts fail on a slow connection (see stream-video.ts)
    { timeout: 15_000 }
)