import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http", // For D1. For DO, we technically don't use this config for runtime, just for generating migrations.
});
