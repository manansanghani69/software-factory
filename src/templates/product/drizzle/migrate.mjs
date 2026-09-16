// Minimal migration runner.
// In production, use drizzle-kit generate + drizzle-kit migrate.
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const sqlite = process.env.DATABASE_URL ?? "./db.sqlite";
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle/meta" });

console.log("Migrations complete.");