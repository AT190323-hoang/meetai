import { nanoid } from "nanoid";
import { pgTable, text, timestamp, boolean, pgEnum, integer } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').$defaultFn(() => false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').$defaultFn(() => /* @__PURE__ */ new Date()).notNull(),
  updatedAt: timestamp('updated_at').$defaultFn(() => /* @__PURE__ */ new Date()).notNull()
});

export const session = pgTable("session", {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })
});

export const account = pgTable("account", {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
});

export const verification = pgTable("verification", {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => /* @__PURE__ */ new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => /* @__PURE__ */ new Date())
});

export const agents = pgTable("agents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  instructions: text("instructions").notNull(),
  createAt: timestamp("created_at").notNull().defaultNow(),
  updateAt: timestamp("updated_at").notNull().defaultNow(),
});

export const meetingStatus = pgEnum("meeting_status", [
  "upcoming",
  "active",
  "completed",
  "processing",
  "cancelled",
]);

export const safetyStatus = pgEnum("safety_status", [
  "pending",
  "safe",
  "flagged",
]);

export const meetings = pgTable("meetings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  status: meetingStatus("status").notNull().default("upcoming"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  transcriptUrl: text("transcript_url"),
  recordingUrl: text("recording_url"),
  summary: text("summary"),
  safetyStatus: safetyStatus("safety_status").notNull().default("pending"),
  // User turns blocked by the realtime guard; persisted so rejoining the call does not reset the kill-switch
  blockedTurns: integer("blocked_turns").notNull().default(0),
  // When the owner acknowledged the safety warning and lifted the quarantine for themselves
  safetyAcknowledgedAt: timestamp("safety_acknowledged_at"),
  createAt: timestamp("created_at").notNull().defaultNow(),
  updateAt: timestamp("updated_at").notNull().defaultNow(),
});

export const safetySource = pgEnum("safety_source", [
  "realtime",
  "chat",
  "post_call",
]);

export const safetyRole = pgEnum("safety_role", ["user", "agent"]);

export const safetyDetector = pgEnum("safety_detector", [
  "content_safety",
  "jailbreak_nemoguard",
  "jailbreak_llm",
  "vn_policy",
]);

// Policy tier of an unsafe verdict (src/lib/safety-policy.ts); null when the content is safe
export const safetySeverity = pgEnum("safety_severity", ["block", "care", "log"]);

// One row per Nemotron verdict, used for flagging and for latency/coverage metrics
export const safetyEvents = pgTable("safety_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  meetingId: text("meeting_id")
    .notNull()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  source: safetySource("source").notNull(),
  role: safetyRole("role").notNull(),
  detector: safetyDetector("detector").notNull().default("content_safety"),
  content: text("content").notNull(),
  unsafe: boolean("unsafe").notNull(),
  severity: safetySeverity("severity"),
  categories: text("categories").array().notNull().default([]),
  latencyMs: integer("latency_ms").notNull(),
  // Realtime only: whether the verdict arrived while the agent was still generating
  caughtInTime: boolean("caught_in_time"),
  error: text("error"),
  createAt: timestamp("created_at").notNull().defaultNow(),
});

