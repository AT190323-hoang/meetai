import { and, eq, isNull, not } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";
import {
    MessageNewEvent,
    CallEndedEvent,
    CallTranscriptionReadyEvent,
    CallRecordingReadyEvent,
    CallSessionParticipantLeftEvent,
    CallSessionStartedEvent,
} from "@stream-io/node-sdk";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";
import { inngest } from "@/inngest/client";
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/index.mjs"
import { generateAvatarUri } from "@/lib/avatar";
import { streamChat } from "@/lib/stream-chat";
import { attachRealtimeGuard } from "@/lib/realtime-guard";
import {
    checkAgentReply,
    checkUserInput,
    hasCareSignal,
    isVnPolicyResult,
    recordSafetyEvent,
    recordUserInputEvents,
    severityOf,
} from "@/lib/safety-events";
import { SUPPORT_NOTE } from "@/lib/safety-policy";
import { VN_CORRECTION_NOTE, withVnPositionNote } from "@/lib/vn-policy";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Fixed replies are in Vietnamese: the product targets Vietnamese users (decision A1)
const CHAT_REFUSAL =
    "Xin lỗi, mình không thể hỗ trợ yêu cầu này. Bạn cần mình giúp gì khác về cuộc họp không?";

const CHAT_LOCKED =
    "Cuộc trò chuyện của meeting này đã bị khóa vì hệ thống an toàn phát hiện nội dung vi phạm.";

// Replaces a generated reply that was flagged as harmful self-harm content
const CHAT_SUPPORT_REPLY =
    "Mình rất tiếc khi bạn đang trải qua điều này. Bạn không phải đối mặt với nó một mình. Hãy thử chia sẻ với người bạn tin tưởng, bác sĩ hoặc chuyên gia tâm lý. Mình vẫn ở đây nếu bạn muốn nói tiếp.";

function verifySignatureWithSDK(body: string, signature: string): boolean {
    return streamVideo.verifyWebhook(body, signature);
};

// Chat messages already being answered, so Stream's webhook retries do not post extra replies.
// In memory: one Node process serves the webhook in dev and on the planned EC2 deployment (A3).
const claimedChatMessages = new Set<string>();
const MAX_CLAIMED_CHAT_MESSAGES = 1000;

function claimChatMessage(messageId: string) {
    if (claimedChatMessages.has(messageId)) {
        return false;
    }
    if (claimedChatMessages.size >= MAX_CLAIMED_CHAT_MESSAGES) {
        // Sets iterate in insertion order, so this drops the oldest id
        claimedChatMessages.delete(claimedChatMessages.values().next().value!);
    }
    claimedChatMessages.add(messageId);
    return true;
}

export async function POST(req: NextRequest) {
    const signature = req.headers.get("x-signature");
    const apiKey = req.headers.get("x-api-key");

    if (!signature || !apiKey) {
        return NextResponse.json(
            { error: "Missing signature or API key" },
            { status: 400 }
        );
    }

    const body = await req.text();

    if (!verifySignatureWithSDK(body, signature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: unknown;

    try {
        payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const eventType = (payload as Record<string, unknown>)?.type;

    if (eventType === "call.session_started") {
        const event = payload as CallSessionStartedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
        }

        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(
                and(
                    eq(meetings.id, meetingId),
                    not(eq(meetings.status, "completed")),
                    not(eq(meetings.status, "active")),
                    not(eq(meetings.status, "cancelled")),
                    not(eq(meetings.status, "processing")),
                )
            );

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        await db
            .update(meetings)
            .set({
                status: "active",
                startedAt: new Date(),
            })
            .where(eq(meetings.id, existingMeeting.id));

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        const call = streamVideo.video.call("default", meetingId);

        // Calls created before members were set up lack the agent; the "user" role alone cannot
        // join arbitrary calls. Best effort: a failure here must not stop the agent from connecting.
        try {
            // The role must be explicit: without it the member gets the user's global role, which has no access
            await call.updateCallMembers({ update_members: [{ user_id: existingAgent.id, role: "call_member" }] });
        } catch (error) {
            console.error(`[webhook] failed to add agent ${existingAgent.id} as a member of call ${meetingId}`, error);
        }

        const realtimeClient = await streamVideo.video.connectOpenAi({
            call,
            openAiApiKey: process.env.OPENAI_API_KEY!,
            agentUserId: existingAgent.id,
        });

        // REALTIME_GUARD=off runs the agent without the guard (baseline for comparisons)
        const guardEnabled = process.env.REALTIME_GUARD !== "off";
        // System-level guidance every agent gets; users cannot remove it
        const instructions = withVnPositionNote(existingAgent.instructions);

        realtimeClient.updateSession({
            instructions,
            // The client's defaults send `turn_detection: null`, which disables VAD and the agent never replies
            turn_detection: { type: "server_vad" },
            // User transcripts are required by the Nemotron realtime guard. Without a language the
            // model guesses it and often writes Vietnamese speech as Chinese or Thai, which the
            // guard then misjudges (a neutral sovereignty question was blocked as a violation)
            ...(guardEnabled && {
                input_audio_transcription: { model: "gpt-4o-mini-transcribe" as const, language: "vi" },
            }),
        });

        if (guardEnabled) {
            attachRealtimeGuard(realtimeClient, {
                meetingId,
                instructions,
                // Kill-switch: ends the call for every participant
                endCall: () => call.end(),
            });
        }
    } else if (eventType === "call.session_participant_left") {
        const event = payload as CallSessionParticipantLeftEvent;
        const meetingId = event.call_cid.split(":")[1];

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId" }, { status: 400 })
        }

        const call = streamVideo.video.call("default", meetingId);

        await call.end();

    } else if (eventType === "call.session_ended") {
        const event = payload as CallEndedEvent;
        const meetingId = event.call.custom?.meetingId;

        if (!meetingId) {
            return NextResponse.json({ error: "Missing meetingId" }, { status: 400 })
        }

        await db
            .update(meetings)
            .set({
                status: "processing",
                endedAt: new Date(),
            })
            .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")))
    } else if (eventType === "call.transcription_ready") {
        const event = payload as CallTranscriptionReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        // Only the first transcription counts: a stray session after the call ended (seen right
        // after the kill-switch) produces an empty one that would overwrite the real transcript
        const [updatedMeeting] = await db
            .update(meetings)
            .set({
                transcriptUrl: event.call_transcription.url,
            })
            .where(and(eq(meetings.id, meetingId), isNull(meetings.transcriptUrl)))
            .returning();

        if (!updatedMeeting) {
            console.log(`[webhook] ignored transcription ${event.call_transcription.filename} for meeting ${meetingId}: not found or already transcribed`);
            return NextResponse.json({ status: "ignored" });
        }

        await inngest.send({
            name: "meetings/processing",
            data: {
                meetingId: updatedMeeting.id,
                transcriptUrl: updatedMeeting.transcriptUrl,
            },
        });
    } else if (eventType === "call.recording_ready") {
        const event = payload as CallRecordingReadyEvent;
        const meetingId = event.call_cid.split(":")[1];

        await db
            .update(meetings)
            .set({
                recordingUrl: event.call_recording.url,
            })
            .where(eq(meetings.id, meetingId));
    } else if (eventType === "message.new") {
        const event = payload as MessageNewEvent;

        const userId = event.user?.id;
        const channelId = event.channel_id;
        const text = event.message?.text;
        const messageId = event.message?.id;

        if (!userId || !channelId || !text || !messageId) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        const [existingMeeting] = await db
            .select()
            .from(meetings)
            .where(and(eq(meetings.id, channelId), eq(meetings.status, "completed")));

        if (!existingMeeting) {
            return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
        }

        const [existingAgent] = await db
            .select()
            .from(agents)
            .where(eq(agents.id, existingMeeting.agentId));

        if (!existingAgent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        // Only the meeting owner may talk to the agent about it: anyone else posting into a channel
        // with this meeting's id would otherwise receive the meeting summary
        if (userId !== existingAgent.id && userId !== existingMeeting.userId) {
            console.warn(`[webhook] ignored chat message from non-owner ${userId} in meeting ${channelId}`);
            return NextResponse.json({ status: "ignored" });
        }

        if (userId !== existingAgent.id) {
            const instructions = `
      You are an AI assistant helping the user revisit a recently completed meeting.
      Below is a summary of the meeting, generated from the transcript:
      
      ${existingMeeting.summary}
      
      The following are your original instructions from the live meeting assistant. Please continue to follow these behavioral guidelines as you assist the user:
      
      ${withVnPositionNote(existingAgent.instructions)}
      
      The user may ask questions about the meeting, request clarifications, or ask for follow-up actions.
      Always base your responses on the meeting summary above.
      
      You also have access to the recent conversation history between you and the user. Use the context of previous messages to provide relevant, coherent, and helpful responses. If the user's question refers to something discussed earlier, make sure to take that into account and maintain continuity in the conversation.
      
      If the summary does not contain enough information to answer a question, politely let the user know.
      
      Be concise, helpful, and focus on providing accurate information from the meeting and the ongoing conversation.
      `;
            // Stream retries a webhook that does not answer within a few seconds, and every retry
            // posted another reply (the guard and GPT take longer than that), so the reply is
            // produced after the response, and a message is answered only once
            if (!claimChatMessage(messageId)) {
                return NextResponse.json({ status: "duplicate" });
            }

            after(async () => {
                try {
                    const channel = streamChat.channel("messaging", channelId);
                    await channel.watch();

                    const replyAsAgent = async (replyText: string) => {
                        const avatarUrl = generateAvatarUri({
                            seed: existingAgent.name,
                            variant: "botttsNeutral",
                        });

                        await streamChat.upsertUser({
                            id: existingAgent.id,
                            name: existingAgent.name,
                            image: avatarUrl,
                        });

                        await channel.sendMessage({
                            text: replyText,
                            user: {
                                id: existingAgent.id,
                                name: existingAgent.name,
                                image: avatarUrl,
                            }
                        });
                    };

                    // Quarantined meetings never reach GPT: the summary may carry content injected during the call (A5)
                    if (existingMeeting.safetyStatus === "flagged") {
                        await replyAsAgent(CHAT_LOCKED);
                        return;
                    }

                    const previousMessages = channel.state.messages
                        .slice(-5)
                        .filter((msg) => msg.text && msg.text.trim() !== "")
                        .map<ChatCompletionMessageParam>((message) => ({
                            role: message.user?.id === existingAgent.id ? "assistant" : "user",
                            content: message.text || "",
                        }));

                    // Chat is text-only, so the guard can block before and after GPT
                    const inputCheck = await checkUserInput(text);
                    void recordUserInputEvents(
                        { meetingId: channelId, source: "chat", content: text },
                        inputCheck.results
                    );

                    let GPTResponseText: string | null = CHAT_REFUSAL;

                    if (inputCheck.severity !== "block") {
                        // Self-harm signals keep the reply supportive instead of refusing (policy tier "care")
                        const supportive = inputCheck.severity === "care" || await hasCareSignal(channelId);

                        const generateReply = async (correction?: string) => {
                            const system = [instructions, supportive && SUPPORT_NOTE, correction].filter(Boolean).join("\n\n");
                            const GPTResponse = await openaiClient.chat.completions.create({
                                messages: [
                                    { role: "system", content: system },
                                    ...previousMessages,
                                    { role: "user", content: text },
                                ],
                                model: "gpt-4o",
                            });
                            return GPTResponse.choices[0].message.content;
                        };

                        const checkReply = async (reply: string) => {
                            const outputCheck = await checkAgentReply(text, reply);
                            for (const result of outputCheck.results) {
                                void recordSafetyEvent({
                                    meetingId: channelId,
                                    source: "chat",
                                    role: "agent",
                                    content: reply,
                                    result,
                                });
                            }
                            return outputCheck;
                        };

                        GPTResponseText = await generateReply();

                        if (!GPTResponseText) {
                            console.error(`[webhook] no GPT response for chat message ${messageId} in meeting ${channelId}`);
                            return;
                        }

                        let outputCheck = await checkReply(GPTResponseText);

                        // A reply that only broke the Vietnam content policy is regenerated once with a correction
                        const policyOnly = outputCheck.severity === "block" && outputCheck.results.every((result) =>
                            severityOf(result, "agent") !== "block" || (isVnPolicyResult(result) && result.violation));
                        if (policyOnly) {
                            const corrected = await generateReply(VN_CORRECTION_NOTE);
                            if (corrected) {
                                GPTResponseText = corrected;
                                outputCheck = await checkReply(corrected);
                            }
                        }

                        if (outputCheck.severity === "block") {
                            GPTResponseText = CHAT_REFUSAL;
                        } else if (outputCheck.severity === "care") {
                            GPTResponseText = CHAT_SUPPORT_REPLY;
                        }
                    }
                    await replyAsAgent(GPTResponseText);
                } catch (error) {
                    console.error(`[webhook] failed to answer chat message ${messageId} in meeting ${channelId}`, error);
                }
            });
        }
    }

    return NextResponse.json({ status: "ok" });
}
