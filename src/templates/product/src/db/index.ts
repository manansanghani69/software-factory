import { drizzle } from "drizzle-orm/better-sqlite3";
import { tasks } from "../../drizzle/schema";

const sqlite = process.env.DATABASE_URL ?? "./db.sqlite";

export const db = drizzle(sqlite);

export { tasks };