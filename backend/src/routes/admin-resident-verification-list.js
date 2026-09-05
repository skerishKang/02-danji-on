import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

export async function handleAdminResidentVerificationList(request, env) {
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

  // operator 또는 admin만 조회 가능
  const reviewers = await sql`
    SELECT
      u.id,
      ur.role
    FROM users u
    JOIN user_roles ur
      ON ur.user_id = u.id
    WHERE u.auth_provider = 'neon_auth'
      AND u.auth_subject = ${authSubject}
      AND u.account_status = 'active'
      AND ur.role IN ('operator', 'admin')
    ORDER BY
      CASE
        WHEN ur.role = 'admin' THEN 1
        ELSE 2
      END
    LIMIT 1
  `;

  if (reviewers.length === 0) {
    return json(
      {
        ok: false,
        error: "FORBIDDEN",
      },
      403
    );
  }

  const rows = await sql`
    SELECT
      rv.id AS verification_id,
      rv.user_id,
      rv.status,
      rv.verification_method,
      rv.submitted_at,

      u.display_name,

      b.building_label,
      h.unit_number

    FROM resident_verifications rv

    JOIN users u
      ON u.id = rv.user_id

    JOIN households h
      ON h.id = rv.household_id

    JOIN buildings b
      ON b.id = h.building_id

    WHERE rv.status = 'pending'

    ORDER BY
      rv.submitted_at ASC,
      rv.id ASC
  `;

  return json({
    ok: true,
    data: {
      count: rows.length,
      verifications: rows.map((row) => ({
        verification_id: row.verification_id,
        user_id: row.user_id,
        display_name: row.display_name,
        status: row.status,
        verification_method: row.verification_method,
        building_label: row.building_label,
        unit_number: row.unit_number,
        submitted_at: row.submitted_at,
      })),
    },
  });
}