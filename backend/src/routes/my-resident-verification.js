import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

export async function handleMyResidentVerification(request, env) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const auth = await verifyAuthToken(request, env);

  if (!auth?.sub) {
    return json(
      {
        ok: false,
        error: "UNAUTHORIZED",
      },
      401
    );
  }

  const sql = getDb(env.DATABASE_URL);
  const authSubject = String(auth.sub);

  const users = await sql`
    SELECT
      id,
      account_status
    FROM users
    WHERE auth_provider = 'neon_auth'
      AND auth_subject = ${authSubject}
    LIMIT 1
  `;

  if (users.length === 0) {
    return json(
      {
        ok: false,
        error: "USER_NOT_FOUND",
      },
      404
    );
  }

  const userId = users[0].id;

  const rows = await sql`
    SELECT
      rv.id AS verification_id,
      rv.status AS verification_status,
      rv.submitted_at,
      rv.reviewed_at,

      b.building_label,
      h.unit_number,

      hm.relationship_type,
      hm.membership_status,

      EXISTS (
        SELECT 1
        FROM user_roles ur
        WHERE ur.user_id = rv.user_id
          AND ur.role = 'resident'
      ) AS has_resident_role

    FROM resident_verifications rv

    JOIN households h
      ON h.id = rv.household_id

    JOIN buildings b
      ON b.id = h.building_id

    LEFT JOIN household_members hm
      ON hm.household_id = rv.household_id
     AND hm.user_id = rv.user_id

    WHERE rv.user_id = ${userId}

    ORDER BY
      rv.submitted_at DESC,
      rv.id DESC

    LIMIT 1
  `;

  if (rows.length === 0) {
    return json({
      ok: true,
      data: {
        verification: null,
      },
    });
  }

  const row = rows[0];

  return json({
    ok: true,
    data: {
      verification: {
        verification_id: row.verification_id,
        status: row.verification_status,
        building_label: row.building_label,
        unit_number: row.unit_number,
        submitted_at: row.submitted_at,
        reviewed_at: row.reviewed_at,
        relationship_type: row.relationship_type,
        membership_status: row.membership_status,
        has_resident_role: row.has_resident_role,
      },
    },
  });
}