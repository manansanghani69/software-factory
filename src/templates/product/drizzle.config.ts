import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/meta",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./db.sqlite",
  },
});