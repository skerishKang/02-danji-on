import { getDb } from "../db/client.js";
import { json } from "./hello.js";

export async function handleBuildings(env) {
  try {
    const sql = getDb(env.DATABASE_URL);

    const rows = await sql`
      SELECT
        b.id,
        b.building_label,
        COUNT(h.id)::text AS household_count
      FROM buildings b
      JOIN complexes c
        ON c.id = b.complex_id
      LEFT JOIN households h
        ON h.building_id = b.id
      WHERE c.slug = 'banglim-myeongji-roadhill'
      GROUP BY b.id, b.building_label, b.sort_order
      ORDER BY b.sort_order
    `;

    return json({
      ok: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to fetch buildings:", error);

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