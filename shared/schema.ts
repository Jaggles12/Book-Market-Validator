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
  blueprintJson: jsonb("blueprint_json").notNull().default({}),
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

export interface BlueprintChapter {
  title: string;
  purpose: string;
  notes: string;
}

export interface BlueprintSection {
  title: string;
  description: string;
  chapters: BlueprintChapter[];
}

export interface BlueprintConstraints {
  word_count_target: number;
  reading_level: string;
  timeframe: string;
}

export interface BlueprintStructure {
  overview: string;
  sections: BlueprintSection[];
}

export interface BlueprintData {
  working_title: string;
  subtitle: string;
  core_promise: string;
  ideal_reader: string;
  differentiation: string;
  format: string;
  constraints: BlueprintConstraints;
  structure: BlueprintStructure;
  voice_and_style: string;
  comparable_titles: string;
  positioning_notes: string;
  primary_keywords: string[];
  whitespace_keywords: string[];
}
