import { user } from './../../../db/schema';
import JSONL from 'jsonl-parse-stringify';
import { agents, meetings, piiReveals, safetyEvents, transcriptItems } from '@/db/schema';
import { db } from '@/db';
import { createTRPCRouter, premiumProcedure, protectedProcedure } from '@/trpc/init';
import { z } from "zod";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/constants';
import { TRPCError } from '@trpc/server';
import { meetingsInsertSchema, meetingsUpdateSchema } from '../schemas';
import { MeetingStatus, StreamTranscriptItem } from '../types';
import { streamVideo } from '@/lib/stream-video';
import { generateAvatarUri } from '@/lib/avatar';

import { streamChat } from '@/lib/stream-chat';
import { getFlagCause } from '@/lib/safety-events';
import { getRealtimeTranscript } from "@/lib/transcript";
import { decryptPii } from "@/lib/pii";

// A flagged meeting stays hidden from its owner until they acknowledge the warning (decision A5)
const isQuarantined = (meeting: { safetyStatus: string; safetyAcknowledgedAt: Date | null }) =>
    meeting.safetyStatus === "flagged" && meeting.safetyAcknowledgedAt === null;

// The list view never needs meeting content, so it is not sent at all
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { summary, transcriptUrl, recordingUrl, ...listColumns } = getTableColumns(meetings);

export const meetingsRouter = createTRPCRouter({
    generateChatToken: protectedProcedure.mutation(async ({ ctx }) => {
        // Plain "user": the "admin" role could read, write and delete every meeting's chat
        await streamChat.upsertUser({
            id: ctx.auth.user.id,
            role: "user",
        });

        // Expiring token; the chat client asks for a new one when it runs out
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;
        return streamChat.createToken(ctx.auth.user.id, expiresAt);
    }),
    prepareChatChannel: protectedProcedure
        .input(z.object({ meetingId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const [existingMeeting] = await db
                .select()
                .from(meetings)
                .where(and(eq(meetings.id, input.meetingId), eq(meetings.userId, ctx.auth.user.id)));

            if (!existingMeeting) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
            }
            if (existingMeeting.safetyStatus === "flagged") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Chat is locked for this meeting" });
            }

            // The server creates the channel after the ownership check; the client only watches it
            const channel = streamChat.channel("messaging", existingMeeting.id, {
                created_by_id: ctx.auth.user.id,
                members: [ctx.auth.user.id],
            });
            await channel.create();
            // Channels created by older client code already have the owner; this is a no-op for them
            await channel.addMembers([ctx.auth.user.id]);

            return { channelId: existingMeeting.id };
        }),

    // Masked personal data in the Vietnamese transcript, shown only to the owner of a meeting that is
    // not quarantined; every reveal is logged (pii_reveals)
    revealPii: protectedProcedure
        .input(z.object({ meetingId: z.string(), itemId: z.string(), index: z.number().int().min(0) }))
        .mutation(async ({ input, ctx }) => {
            const [existingMeeting] = await db
                .select()
                .from(meetings)
                .where(and(eq(meetings.id, input.meetingId), eq(meetings.userId, ctx.auth.user.id)));
            if (!existingMeeting) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
            }
            if (isQuarantined(existingMeeting)) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Acknowledge the safety warning first" });
            }

            const [item] = await db
                .select({ pii: transcriptItems.pii })
                .from(transcriptItems)
                .where(and(eq(transcriptItems.id, input.itemId), eq(transcriptItems.meetingId, existingMeeting.id)));
            const value = item?.pii ? decryptPii(item.pii)[input.index] : undefined;
            if (value === undefined) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Nothing to reveal" });
            }

            await db.insert(piiReveals).values({
                meetingId: existingMeeting.id,
                transcriptItemId: input.itemId,
                valueIndex: input.index,
                userId: ctx.auth.user.id,
            });
            return { value };
        }),

    getTranscript: protectedProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ input, ctx }) => {
            const [existingMeeting] = await db
                .select()
                .from(meetings)
                .where(
                    and(eq(meetings.id, input.id), eq(meetings.userId, ctx.auth.user.id))
                );

            if (!existingMeeting) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Meeting not found",
                });
            }

            if (isQuarantined(existingMeeting)) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Acknowledge the safety warning to view this transcript",
                });
            }

            // The Vietnamese transcript recorded in the call comes first; Stream's is an English translation
            const realtimeTranscript = await getRealtimeTranscript(existingMeeting.id);
            if (realtimeTranscript.length === 0 && !existingMeeting.transcriptUrl) {
                return [];
            }

            const transcript = realtimeTranscript.length > 0
                ? realtimeTranscript
                : await fetch(existingMeeting.transcriptUrl!)
                    .then((res) => res.text())
                    .then((text) => JSONL.parse<StreamTranscriptItem>(text))
                    .catch(() => {
                        return [];
                    });

            const speakerIds = [
                ...new Set(transcript.map((items) => items.speaker_id))
            ]

            const userSpeakers = await db
                .select()
                .from(user)
                .where(inArray(user.id, speakerIds))
                .then((users) =>
                    users.map((user) => ({
                        ...user,
                        image:
                            user.image ??
                            generateAvatarUri({ seed: user.name, variant: "initials" }),
                    }))
                );

            const agentSpeakers = await db
                .select()
                .from(agents)
                .where(inArray(agents.id, speakerIds))
                .then((agents) =>
                    agents.map((agent) => ({
                        ...agent,
                        image: generateAvatarUri({
                            seed: agent.name,
                            variant: "botttsNeutral",
                        }),
                    }))
                );
            const speakers = [...userSpeakers, ...agentSpeakers];
            const transcriptWithSpeakers = transcript.map((item) => {
                const speaker = speakers.find(
                    (speaker) => speaker.id === item.speaker_id
                );

                if (!speaker) {
                    return {
                        ...item,
                        user: {
                            name: "Unknown",
                            image: generateAvatarUri({
                                seed: "Unknown",
                                variant: "initials",
                            })
                        }
                    }
                }

                return {
                    ...item,
                    user: {
                        name: speaker.name,
                        image: speaker.image,
                    },
                }
            })
            return transcriptWithSpeakers;
        }),

    generateToken: protectedProcedure
        .input(z.object({ meetingId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const [existingMeeting] = await db
                .select({ id: meetings.id })
                .from(meetings)
                .where(and(eq(meetings.id, input.meetingId), eq(meetings.userId, ctx.auth.user.id)));

            if (!existingMeeting) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
            }

            // Plain "user": the "admin" role could delete calls and recordings of every meeting
            await streamVideo.upsertUsers([
                {
                    id: ctx.auth.user.id,
                    name: ctx.auth.user.name,
                    role: "user",
                    image:
                        ctx.auth.user.image ??
                        generateAvatarUri({ seed: ctx.auth.user.name, variant: "initials" })
                },
            ]);

            // A call token only works for this meeting's call and makes the owner a member of it;
            // the "user" role itself has no access to arbitrary calls (see docs/safety-guard.md)
            return streamVideo.generateCallToken({
                user_id: ctx.auth.user.id,
                call_cids: [`default:${existingMeeting.id}`],
                exp: Math.floor(Date.now() / 1000) + 3600,
            });
        }),

    remove: protectedProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const [removedMeeting] = await db
                .delete(meetings)
                .where(
                    and(
                        eq(meetings.id, input.id),
                        eq(meetings.userId, ctx.auth.user.id),
                    )
                )
                .returning();
            if (!removedMeeting) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Meeting not found"
                });
            }
            return removedMeeting;
        }),
    update: protectedProcedure
        .input(meetingsUpdateSchema)
        .mutation(async ({ ctx, input }) => {
            const [updateMeeting] = await db
                .update(meetings)
                .set(input)
                .where(
                    and(
                        eq(meetings.id, input.id),
                        eq(meetings.userId, ctx.auth.user.id),
                    )
                )
                .returning();
            if (!updateMeeting) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Meeting not found"
                });
            }
            return updateMeeting;
        }),
    create: premiumProcedure("meetings")
        .input(meetingsInsertSchema)
        .mutation(async ({ input, ctx }) => {
            const [createdMeeting] = await db
                .insert(meetings)
                .values({
                    ...input,
                    userId: ctx.auth.user.id,
                })
                .returning();
            const [existingAgent] = await db
                .select()
                .from(agents)
                .where(eq(agents.id, createdMeeting.agentId));

            if (!existingAgent) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Agent not found"
                });
            }

            // Both must exist on Stream before they can be added as call members
            await streamVideo.upsertUsers([
                {
                    id: ctx.auth.user.id,
                    name: ctx.auth.user.name,
                    role: "user",
                    image:
                        ctx.auth.user.image ??
                        generateAvatarUri({ seed: ctx.auth.user.name, variant: "initials" })
                },
                {
                    id: existingAgent.id,
                    name: existingAgent.name,
                    role: "user",
                    image: generateAvatarUri({
                        seed: existingAgent.name,
                        variant: "botttsNeutral",
                    }),
                }
            ]);

            const call = streamVideo.video.call("default", createdMeeting.id);
            await call.create({
                data: {
                    created_by_id: ctx.auth.user.id,
                    // Access to the call comes from membership, not from the global "user" role
                    members: [
                        { user_id: ctx.auth.user.id, role: "call_member" },
                        { user_id: existingAgent.id, role: "call_member" },
                    ],
                    custom: {
                        meetingId: createdMeeting.id,
                        meetingName: createdMeeting.name
                    },
                    settings_override: {
                        transcription: {
                            language: "en",
                            mode: "auto-on",
                            closed_caption_mode: "auto-on",
                        },
                        recording: {
                            mode: "auto-on",
                            quality: "1080p",
                        },
                    },
                },
            });

            return createdMeeting;
        }),

    getOne: protectedProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ input, ctx }) => {
            const [existingMeeting] = await db
                .select({
                    ...getTableColumns(meetings),
                    agent: agents,
                    duration: sql<number>`EXTRACT(EPOCH FROM (ended_at - started_at))`.as("duration"),
                })
                .from(meetings)
                .innerJoin(agents, eq(meetings.agentId, agents.id))
                .where(and(
                    eq(meetings.id, input.id),
                    eq(meetings.userId, ctx.auth.user.id),
                )
                );
            if (!existingMeeting) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
            }

            const quarantined = isQuarantined(existingMeeting);
            const flaggedBy = existingMeeting.safetyStatus === "flagged"
                ? await getFlagCause(existingMeeting.id)
                : null;

            return {
                ...existingMeeting,
                summary: quarantined ? null : existingMeeting.summary,
                transcriptUrl: quarantined ? null : existingMeeting.transcriptUrl,
                recordingUrl: quarantined ? null : existingMeeting.recordingUrl,
                quarantined,
                flaggedBy,
            };
        }),
    acknowledgeSafety: protectedProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ input, ctx }) => {
            // The timestamp is the evidence of who lifted the quarantine and when; the flag itself stays
            const [acknowledgedMeeting] = await db
                .update(meetings)
                .set({ safetyAcknowledgedAt: new Date() })
                .where(and(
                    eq(meetings.id, input.id),
                    eq(meetings.userId, ctx.auth.user.id),
                    eq(meetings.safetyStatus, "flagged"),
                    isNull(meetings.safetyAcknowledgedAt),
                ))
                .returning();

            if (!acknowledgedMeeting) {
                throw new TRPCError({ code: "NOT_FOUND", message: "No unacknowledged flagged meeting found" });
            }

            return acknowledgedMeeting;
        }),
    getSafetyEvents: protectedProcedure
        .input(z.object({ id: z.string() }))
        .query(async ({ input, ctx }) => {
            const [existingMeeting] = await db
                .select()
                .from(meetings)
                .where(and(eq(meetings.id, input.id), eq(meetings.userId, ctx.auth.user.id)));

            if (!existingMeeting) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
            }

            if (isQuarantined(existingMeeting)) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Acknowledge the safety warning to view safety events",
                });
            }

            // Only verdicts the policy tiered; safe verdicts are not shown
            return db
                .select({
                    id: safetyEvents.id,
                    source: safetyEvents.source,
                    role: safetyEvents.role,
                    detector: safetyEvents.detector,
                    severity: safetyEvents.severity,
                    categories: safetyEvents.categories,
                    content: safetyEvents.content,
                    createAt: safetyEvents.createAt,
                })
                .from(safetyEvents)
                .where(and(eq(safetyEvents.meetingId, input.id), isNotNull(safetyEvents.severity)))
                .orderBy(asc(safetyEvents.createAt));
        }),
    getMany: protectedProcedure
        .input(z.object({
            page: z.number().default(DEFAULT_PAGE),
            pageSize: z
                .number()
                .min(MIN_PAGE_SIZE)
                .max(MAX_PAGE_SIZE)
                .default(DEFAULT_PAGE_SIZE),
            search: z.string().nullish(),
            agentId: z.string().nullish(),
            status: z
                .enum([
                    MeetingStatus.Upcoming,
                    MeetingStatus.Active,
                    MeetingStatus.Completed,
                    MeetingStatus.Processing,
                    MeetingStatus.Cancelled,
                ])
                .nullish(),
        })
        )
        .query(async ({ ctx, input }) => {
            const { search, page, pageSize, status, agentId } = input;


            const data = await db
                .select({
                    ...listColumns,
                    agent: agents,
                    duration: sql<number>`EXTRACT(EPOCH FROM (ended_at - started_at))`.as("duration"),
                })
                .from(meetings)
                .innerJoin(agents, eq(meetings.agentId, agents.id))
                .where(
                    and(
                        eq(meetings.userId, ctx.auth.user.id),
                        search ? ilike(meetings.name, `%${search}%`) : undefined,
                        status ? eq(meetings.status, status) : undefined,
                        agentId ? eq(meetings.agentId, agentId) : undefined,
                    )
                )
                .orderBy(desc(meetings.createAt), desc(meetings.id))
                .limit(pageSize)
                .offset((page - 1) * pageSize)

            const [total] = await db
                .select({ count: count() })
                .from(meetings)
                .innerJoin(agents, eq(meetings.agentId, agents.id))
                .where(
                    and(
                        eq(meetings.userId, ctx.auth.user.id),
                        search ? ilike(meetings.name, `%${search}%`) : undefined,
                        status ? eq(meetings.status, status) : undefined,
                        agentId ? eq(meetings.agentId, agentId) : undefined,
                    )
                );
            const totalPages = Math.ceil(total.count / pageSize)

            return {
                items: data,
                total: total.count,
                totalPages,
            };

        }),

});
