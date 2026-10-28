import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { StreamTranscriptItem } from "@/modules/meetings/types";
import { and, eq, inArray, ne } from "drizzle-orm";
import JSONL from "jsonl-parse-stringify";
import { createAgent, openai, TextMessage } from "@inngest/agent-kit";
import { SUMMARY_MODEL } from "@/lib/models";
import { checkAgentReply, checkUserInput, recordSafetyEvent, recordUserInputEvents } from "@/lib/safety-events";

const summerizer = createAgent({
  name: "summarizer",
  system: `
  You are an expert summarizer. You write readable, concise, simple content. You are given a transcript of a meeting and you need to summarize it.

Write the whole summary in Vietnamese, the language of the users, including the headings ("### Tổng quan" for Overview, "### Ghi chú" for Notes).
The transcript is an automatic English translation of Vietnamese speech, so some words are mistranscribed (for example "Tick Fun" for "tích phân"). Infer the intended meaning from context, and never invent content that was not discussed.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the session's content. Focus on major features, user workflows, and any key takeaways. Write in a narrative style, using full sentences. Highlight unique or powerful aspects of the product, platform, or discussion.

### Notes
Break down key content into thematic sections with timestamp ranges. Each section should summarize key points, actions, or demos in bullet format.

Example:
#### Section Name
- Main point or demo shown here
- Another key insight or interaction
- Follow-up tool or explanation provided

#### Next Section
- Feature X automatically does Y
- Mention of integration with Z
  `.trim(),
  model: openai({ model: SUMMARY_MODEL, apiKey: process.env.OPENAI_API_KEY }),
});

export const meetingsProcessing = inngest.createFunction(
  { id: "meetings/processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    const response = await step.run("fetch-transcript", async () => {
      return fetch(event.data.transcriptUrl).then((res) => res.text());
    });

    const transcript = await step.run("parse-transcript", async () => {
      return JSONL.parse<StreamTranscriptItem>(response);
    });

    const transcriptWithSpeakers = await step.run("add-speakers", async () => {
      const speakerIds = [
        ...new Set(transcript.map((item) => item.speaker_id)),
      ];

      const userSpeakers = await db
        .select()
        .from(user)
        .where(inArray(user.id, speakerIds))
        .then((users) =>
          users.map((user) => ({
            ...user,
          }))
        );

      const agentSpeakers = await db
        .select()
        .from(agents)
        .where(inArray(agents.id, speakerIds))
        .then((agents) =>
          agents.map((agent) => ({
            ...agent,
          }))
        );

      const speakers = [...userSpeakers, ...agentSpeakers];

      return transcript.map((item) => {
        const speaker = speakers.find(
          (speaker) => speaker.id === item.speaker_id
        );

        if (!speaker) {
          return {
            ...item,
            user: {
              name: "Unknown",
            },
          };
        }

        return {
          ...item,
          user: {
            name: speaker.name,
          },
        }
      })
    });

    // Nothing was said: asking the model anyway stores its apology as the summary
    if (transcriptWithSpeakers.length === 0) {
      await step.run("save-empty-summary", async () => {
        await db
          .update(meetings)
          .set({ summary: null, status: "completed" })
          .where(eq(meetings.id, event.data.meetingId))
      })
      return;
    }

    const { output } = await summerizer.run(
      "Summarize the following transcript: " +
      JSON.stringify(transcriptWithSpeakers)
    );

    await step.run("save-summary", async () => {
      await db
        .update(meetings)
        .set({
          summary: (output[0] as TextMessage).content as string,
          status: "completed",
        })
        .where(eq(meetings.id, event.data.meetingId))
    })
  }
);

// Nemotron context is ~8K tokens, so each side of a turn is capped
const MAX_TURN_CHARS = 4000;
const AUDIT_BATCH_SIZE = 5;

export const meetingsSafetyAudit = inngest.createFunction(
  { id: "meetings/safety-audit" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    const meetingId: string = event.data.meetingId;

    const turns = await step.run("build-turns", async () => {
      const [meeting] = await db
        .select({ agentId: meetings.agentId })
        .from(meetings)
        .where(eq(meetings.id, meetingId));

      if (!meeting) {
        return [];
      }

      const transcript = JSONL.parse<StreamTranscriptItem>(
        await fetch(event.data.transcriptUrl).then((res) => res.text())
      );

      // Merge consecutive items from the same speaker into one utterance
      const utterances: { role: "user" | "agent"; text: string }[] = [];
      for (const item of transcript) {
        const role = item.speaker_id === meeting.agentId ? "agent" : "user";
        const last = utterances[utterances.length - 1];
        if (last && last.role === role) {
          last.text += ` ${item.text}`;
        } else {
          utterances.push({ role, text: item.text });
        }
      }

      // Pair each user utterance with the agent reply that follows it
      const pairs: { query: string; response?: string }[] = [];
      for (const utterance of utterances) {
        const text = utterance.text.trim().slice(0, MAX_TURN_CHARS);
        const last = pairs[pairs.length - 1];
        if (utterance.role === "user") {
          pairs.push({ query: text });
        } else if (last && last.response === undefined) {
          last.response = text;
        } else {
          pairs.push({ query: "", response: text });
        }
      }

      return pairs;
    });

    for (let i = 0; i < turns.length; i += AUDIT_BATCH_SIZE) {
      await step.run(`audit-turns-${i}`, async () => {
        const batch = turns.slice(i, i + AUDIT_BATCH_SIZE);

        // The user message is checked alone (as in the call); the pair is only used for the reply
        await Promise.all(batch.map(async (turn) => {
          const [userCheck, replyCheck] = await Promise.all([
            turn.query ? checkUserInput(turn.query) : null,
            turn.response ? checkAgentReply(turn.query, turn.response) : null,
          ]);

          if (turn.query && userCheck) {
            await recordUserInputEvents(
              { meetingId, source: "post_call", content: turn.query },
              userCheck.results
            );
          }
          if (turn.response && replyCheck) {
            await Promise.all(replyCheck.results.map((result) => recordSafetyEvent({
              meetingId,
              source: "post_call",
              role: "agent",
              content: turn.response!,
              result,
            })));
          }
        }));
      });
    }

    await step.run("finalize-safety-status", async () => {
      // Meetings already flagged by the realtime/chat guard or by this audit stay flagged
      await db
        .update(meetings)
        .set({ safetyStatus: "safe" })
        .where(and(eq(meetings.id, meetingId), ne(meetings.safetyStatus, "flagged")));
    });
  }
);