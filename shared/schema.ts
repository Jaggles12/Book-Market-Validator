import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const savedResults = pgTable("saved_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  niche: text("niche").notNull(),
  verdict: varchar("verdict", { length: 10 }).notNull(),
  demandScore: varchar("demand_score", { length: 20 }).notNull(),
  competitionScore: varchar("competition_score", { length: 20 }).notNull(),
  keyInsights: text("key_insights"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  fullReportJson: jsonb("full_report_json").notNull(),
});

export const insertSavedResultSchema = createInsertSchema(savedResults).omit({
  id: true,
  createdAt: true,
});

export type InsertSavedResult = z.infer<typeof insertSavedResultSchema>;
export type SavedResult = typeof savedResults.$inferSelect;
