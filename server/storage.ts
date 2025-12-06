import { type User, type InsertUser, type SavedResult, type InsertSavedResult, savedResults } from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
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
  getAllResults(): Promise<SavedResult[]>;
  getResultById(id: string): Promise<SavedResult | undefined>;
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

  async getAllResults(): Promise<SavedResult[]> {
    return await db.select().from(savedResults).orderBy(desc(savedResults.createdAt));
  }

  async getResultById(id: string): Promise<SavedResult | undefined> {
    const [result] = await db.select().from(savedResults).where(eq(savedResults.id, id));
    return result;
  }
}

export const storage = new MemStorage();
