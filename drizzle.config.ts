import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/sqlite/src/schema.ts",
  out: "./src/sqlite/drizzle",
  dbCredentials: {
    url: process.env.JOB_SEARCH_DB
      ?? process.env.JOB_SEARCH_DATABASE
      ?? "./context/data/job-search.sqlite",
  },
  strict: true,
  verbose: true,
});
