import { getDb } from "../db/client.js";
import { json } from "./hello.js";

export async function handleComplexes(env) {
  try {
    const sql = getDb(env.DATABASE_URL);

    const rows = await sql`
      SELECT id, name, slug, status
      FROM complexes
      ORDER BY id
    `;

    return json({
      ok: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to fetch complexes:", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: "DATABASE_ERROR",
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=UTF-8",
        },
      }
    );
  }
}