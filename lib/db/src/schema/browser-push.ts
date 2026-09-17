import {
  bigserial,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * The single, durable VAPID identity. Private key material is AES-GCM
 * encrypted by the API before it reaches PostgreSQL.
 */
export const browserPushVapidKeys = pgTable("browser_push_vapid_keys", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Browser endpoints are bound to both a citizen and the exact login session. */
export const browserPushSubscriptions = pgTable("browser_push_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull(),
  installationId: text("installation_id").notNull(),
  endpoint: text("endpoint").notNull(),
  encryptedKeys: text("encrypted_keys").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  endpointUnique: uniqueIndex("browser_push_subscriptions_endpoint_uniq").on(table.endpoint),
  installationUnique: uniqueIndex("browser_push_subscriptions_installation_uniq")
    .on(table.userId, table.sessionHash, table.installationId),
}));

/** A durable claim prevents duplicate notification fanout for one call/device. */
export const browserPushDeliveries = pgTable("browser_push_deliveries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subscriptionId: integer("subscription_id").notNull(),
  callId: text("call_id").notNull(),
  notificationType: text("notification_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  deliveryUnique: uniqueIndex("browser_push_deliveries_dedupe_uniq")
    .on(table.subscriptionId, table.callId, table.notificationType),
}));