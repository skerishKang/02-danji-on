import { neon } from "@neondatabase/serverless";

export function getDb(databaseUrl) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(databaseUrl);
}
