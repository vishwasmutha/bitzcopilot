import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dbSsl } from "./ssl";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: dbSsl(databaseUrl),
    // Small pool: serverless instances each hold their own, and the hosted database caps total connections.
    max: Number(process.env.DB_POOL_MAX) || 5,
    idleTimeoutMillis: 20_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
