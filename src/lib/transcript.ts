import "server-only";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { transcriptItems } from "@/db/schema";
import type { StreamTranscriptItem } from "@/modules/meetings/types";

/**
 * The meeting's Vietnamese transcript recorded during the call, in Stream's transcript shape, or an
 * empty list when none was recorded (calls before 28/10/2026, or REALTIME_GUARD=off). Consecutive
 * lines of one speaker are merged: server VAD often splits one sentence at a pause.
 */
export async function getRealtimeTranscript(meetingId: string): Promise<StreamTranscriptItem[]> {
    const rows = await db
        .select()
        .from(transcriptItems)
        .where(eq(transcriptItems.meetingId, meetingId))
        .orderBy(asc(transcriptItems.startMs));

    const items: StreamTranscriptItem[] = [];
    for (const row of rows) {
        const last = items.at(-1);
        if (last && last.speaker_id === row.speakerId) {
            last.text = `${last.text} ${row.content}`;
            last.stop_ts = Math.max(last.stop_ts, row.endMs);
            continue;
        }
        items.push({ speaker_id: row.speakerId, type: "speech", text: row.content, start_ts: row.startMs, stop_ts: row.endMs });
    }
    return items;
}
