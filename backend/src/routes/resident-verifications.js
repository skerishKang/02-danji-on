import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

export async function handleResidentVerification(request, env) {
  if (request.method !== "POST") {
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

  const authUsers = await sql`
    SELECT
      id,
      name,
      email,
      "emailVerified"
    FROM neon_auth."user"
    WHERE id::text = ${authSubject}
    LIMIT 1
  `;

  if (authUsers.length === 0 || !authUsers[0].emailVerified) {
    return json(
      {
        ok: false,
        error: "AUTH_USER_NOT_VERIFIED",
      },
      403
    );
  }

  const authUser = authUsers[0];

  const users = await sql`
    INSERT INTO users (
      auth_provider,
      auth_subject,
      display_name
    )
    VALUES (
      'neon_auth',
      ${authSubject},
      ${authUser.name}
    )
    ON CONFLICT (auth_provider, auth_subject)
      WHERE auth_provider IS NOT NULL
        AND auth_subject IS NOT NULL
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      updated_at = NOW()
    RETURNING id
  `;

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "INVALID_JSON",
      },
      400
    );
  }

  const buildingLabel = String(body.building_label ?? "").trim();
  const unitNumber = String(body.unit_number ?? "").trim();

  if (!buildingLabel || !unitNumber) {
    return json(
      {
        ok: false,
        error: "BUILDING_AND_UNIT_REQUIRED",
      },
      400
    );
  }

  const households = await sql`
    SELECT
      h.id,
      b.building_label,
      h.unit_number
    FROM households h
    JOIN buildings b
      ON b.id = h.building_id
    JOIN complexes c
      ON c.id = b.complex_id
    WHERE c.slug = 'banglim-myeongji-roadhill'
      AND b.building_label = ${buildingLabel}
      AND h.unit_number = ${unitNumber}
      AND h.status = 'active'
    LIMIT 1
  `;

  if (households.length === 0) {
    return json(
      {
        ok: false,
        error: "HOUSEHOLD_NOT_FOUND",
      },
      404
    );
  }

  const existing = await sql`
    SELECT
      id,
      status
    FROM resident_verifications
    WHERE user_id = ${users[0].id}
      AND household_id = ${households[0].id}
      AND status IN ('pending', 'approved', 'needs_revision')
    ORDER BY id DESC
    LIMIT 1
  `;

  if (existing.length > 0) {
    return json(
      {
        ok: false,
        error: "VERIFICATION_ALREADY_EXISTS",
        data: {
          verification_id: existing[0].id,
          status: existing[0].status,
        },
      },
      409
    );
  }

  const created = await sql`
    INSERT INTO resident_verifications (
      user_id,
      household_id,
      verification_method,
      status
    )
    VALUES (
      ${users[0].id},
      ${households[0].id},
      'manual_operator',
      'pending'
    )
    RETURNING
      id,
      status,
      submitted_at
  `;

  return json(
    {
      ok: true,
      data: {
        verification_id: created[0].id,
        status: created[0].status,
        building_label: households[0].building_label,
        unit_number: households[0].unit_number,
        submitted_at: created[0].submitted_at,
      },
    },
    201
  );
}