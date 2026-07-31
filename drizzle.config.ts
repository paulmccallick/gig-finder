import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/data/src/schema.ts",
  out: "./src/data/drizzle",
  dbCredentials: {
    url: process.env.GIG_FINDER_DB
      ?? process.env.GIG_FINDER_DATABASE
      ?? process.env.JOB_SEARCH_DB
      ?? process.env.JOB_SEARCH_DATABASE
      ?? "./context/data/gig-finder.sqlite",
  },
  strict: true,
  verbose: true,
});
