import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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

export const bookBlueprints = pgTable("book_blueprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  validationId: text("validation_id").notNull(),
  workingTitle: text("working_title").notNull().default(""),
  readerAvatar: text("reader_avatar").notNull().default(""),
  primaryPromise: text("primary_promise").notNull().default(""),
  coreProblem: text("core_problem").notNull().default(""),
  bigDifferentiator: text("big_differentiator").notNull().default(""),
  coreTopics: text("core_topics").notNull().default(""),
  contentShape: text("content_shape").notNull().default(""),
  targetLengthWords: integer("target_length_words"),
  toneStyle: text("tone_style").notNull().default(""),
  compTitles: text("comp_titles").notNull().default(""),
  positioningNotes: text("positioning_notes").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userValidationUnique: uniqueIndex("user_validation_unique_idx").on(table.userId, table.validationId),
}));

export const insertBookBlueprintSchema = createInsertSchema(bookBlueprints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBookBlueprint = z.infer<typeof insertBookBlueprintSchema>;
export type BookBlueprint = typeof bookBlueprints.$inferSelect;
