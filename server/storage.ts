import { type User, type InsertUser, type SavedResult, type InsertSavedResult, savedResults, type BookBlueprint, type InsertBookBlueprint, bookBlueprints, type BlueprintData } from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc, and } from "drizzle-orm";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  saveResult(result: InsertSavedResult): Promise<SavedResult>;
  getAllResultsByUser(userId: string): Promise<SavedResult[]>;
  getResultById(id: string, userId: string): Promise<SavedResult | undefined>;
  deleteResult(id: string, userId: string): Promise<boolean>;
  getBlueprint(userId: string, validationId: string): Promise<BookBlueprint | undefined>;
  saveBlueprint(blueprint: InsertBookBlueprint): Promise<BookBlueprint>;
  upsertBlueprint(userId: string, validationId: string, blueprintData: BlueprintData): Promise<BookBlueprint>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async saveResult(result: InsertSavedResult): Promise<SavedResult> {
    const [saved] = await db.insert(savedResults).values(result).returning();
    return saved;
  }

  async getAllResultsByUser(userId: string): Promise<SavedResult[]> {
    return await db.select().from(savedResults)
      .where(eq(savedResults.userId, userId))
      .orderBy(desc(savedResults.createdAt));
  }

  async getResultById(id: string, userId: string): Promise<SavedResult | undefined> {
    const [result] = await db.select().from(savedResults)
      .where(and(eq(savedResults.id, id), eq(savedResults.userId, userId)));
    return result;
  }

  async deleteResult(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(savedResults)
      .where(and(eq(savedResults.id, id), eq(savedResults.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async getBlueprint(userId: string, validationId: string): Promise<BookBlueprint | undefined> {
    const [blueprint] = await db.select().from(bookBlueprints)
      .where(and(eq(bookBlueprints.userId, userId), eq(bookBlueprints.validationId, validationId)));
    return blueprint;
  }

  async saveBlueprint(blueprint: InsertBookBlueprint): Promise<BookBlueprint> {
    const [saved] = await db.insert(bookBlueprints).values(blueprint).returning();
    return saved;
  }

  async upsertBlueprint(userId: string, validationId: string, blueprintData: BlueprintData): Promise<BookBlueprint> {
    const existing = await this.getBlueprint(userId, validationId);
    
    if (existing) {
      const [updated] = await db.update(bookBlueprints)
        .set({
          blueprintJson: blueprintData,
          updatedAt: new Date(),
        })
        .where(and(eq(bookBlueprints.userId, userId), eq(bookBlueprints.validationId, validationId)))
        .returning();
      return updated;
    } else {
      const newBlueprint: InsertBookBlueprint = {
        userId,
        validationId,
        blueprintJson: blueprintData,
      };
      return this.saveBlueprint(newBlueprint);
    }
  }
}

export const storage = new MemStorage();
