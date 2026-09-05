import { getDb } from "../db/client.js";
import { json } from "./hello.js";

export async function handleTestUsers(env) {
  try {
    const sql = getDb(env.DATABASE_URL);

    const rows = await sql`
      SELECT id, name, created_at
      FROM test_users
      ORDER BY id ASC
    `;

    return json({
      ok: true,
      data: rows,
    });
  } catch (error) {
    console.error("test_users query failed", error);

    return json(
      {
        ok: false,
        error: "Database query failed",
      },
      500,
    );
  }
}
