import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";

// =========================================
// Auth & D1 Tables (AUTH_DB)
// =========================================

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  tier: text("tier").notNull().default("free"),
});

export const sessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => users.id),
});

export const accounts = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => users.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt"),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt").notNull(),
  createdAt: integer("createdAt"),
  updatedAt: integer("updatedAt"),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  expiresAt: integer("expires_at"),
  scopes: text("scopes").default("read,write"), // stored as JSON string
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  lastAccessedAt: integer("last_accessed_at"),
});

export const planLimits = sqliteTable("plan_limits", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  maxRooms: integer("max_rooms").notNull().default(3),
  planTier: text("plan_tier").notNull().default("free"),
});

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  roomId: text("room_id").notNull(),
  tableName: text("table_name").notNull(),
  canRead: integer("can_read").notNull().default(0),
  canWrite: integer("can_write").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// =========================================
// Durable Object Tables (NanoStore)
// =========================================

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title"),
  status: text("status"),
  ownerId: text("owner_id"),
});

export const webhooks = sqliteTable("_webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events").notNull(),
  secret: text("secret"),
  active: integer("active", { mode: 'boolean' }).default(true),
  createdAt: integer("created_at").notNull(),
  lastTriggeredAt: integer("last_triggered_at"),
  failureCount: integer("failure_count").default(0),
});

// Type Exports
export type User = InferSelectModel<typeof users>;
export type InsertUser = InferInsertModel<typeof users>;

export type Session = InferSelectModel<typeof sessions>;
export type Account = InferSelectModel<typeof accounts>;
export type ApiKey = InferSelectModel<typeof apiKeys>;
export type Room = InferSelectModel<typeof rooms>;
export type Task = InferSelectModel<typeof tasks>;
export type Webhook = InferSelectModel<typeof webhooks>;
