import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

export async function handleApproveResidentVerification(
  request,
  env,
  verificationId
) {
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

  if (!/^\d+$/.test(String(verificationId))) {
    return json(
      {
        ok: false,
        error: "INVALID_VERIFICATION_ID",
      },
      400
    );
  }

  const sql = getDb(env.DATABASE_URL);
  const authSubject = String(auth.sub);

  // 승인자는 반드시 operator 또는 admin 권한을 가진 활성 사용자여야 한다.
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

  const reviewerId = reviewers[0].id;

  /*
   * 한 SQL 작업 안에서:
   * 1. pending → approved
   * 2. household_members → verified
   * 3. user_roles → resident 추가
   *
   * 자기 자신의 주민인증은 승인할 수 없다.
   */
  const approved = await sql`
    WITH approved_verification AS (
      UPDATE resident_verifications
      SET
        status = 'approved',
        reviewed_at = NOW(),
        reviewed_by_user_id = ${reviewerId},
        updated_at = NOW()
      WHERE id = ${verificationId}
        AND status = 'pending'
        AND user_id <> ${reviewerId}
      RETURNING
        id,
        user_id,
        household_id,
        status,
        reviewed_at
    ),

    membership AS (
      INSERT INTO household_members (
        household_id,
        user_id,
        relationship_type,
        membership_status,
        joined_at,
        ended_at
      )
      SELECT
        household_id,
        user_id,
        'resident',
        'verified',
        NOW(),
        NULL
      FROM approved_verification
      ON CONFLICT (household_id, user_id)
      DO UPDATE SET
        relationship_type = 'resident',
        membership_status = 'verified',
        joined_at = COALESCE(
          household_members.joined_at,
          NOW()
        ),
        ended_at = NULL
      RETURNING
        id,
        household_id,
        user_id,
        membership_status
    ),

    resident_role AS (
      INSERT INTO user_roles (
        user_id,
        role
      )
      SELECT
        user_id,
        'resident'
      FROM approved_verification
      ON CONFLICT (user_id, role)
      DO NOTHING
      RETURNING
        user_id,
        role
    )

    SELECT
      av.id AS verification_id,
      av.user_id,
      av.household_id,
      av.status,
      av.reviewed_at,
      hm.id AS household_member_id,
      hm.membership_status
    FROM approved_verification av
    JOIN membership hm
      ON hm.user_id = av.user_id
     AND hm.household_id = av.household_id
  `;

  if (approved.length === 0) {
    const existing = await sql`
      SELECT
        id,
        user_id,
        status
      FROM resident_verifications
      WHERE id = ${verificationId}
      LIMIT 1
    `;

    if (existing.length === 0) {
      return json(
        {
          ok: false,
          error: "VERIFICATION_NOT_FOUND",
        },
        404
      );
    }

    if (
      existing[0].status === "pending" &&
      String(existing[0].user_id) === String(reviewerId)
    ) {
      return json(
        {
          ok: false,
          error: "SELF_APPROVAL_FORBIDDEN",
        },
        403
      );
    }

    return json(
      {
        ok: false,
        error: "VERIFICATION_NOT_PENDING",
        data: {
          verification_id: existing[0].id,
          status: existing[0].status,
        },
      },
      409
    );
  }

  return json({
    ok: true,
    data: {
      verification_id: approved[0].verification_id,
      user_id: approved[0].user_id,
      household_id: approved[0].household_id,
      status: approved[0].status,
      household_member_id: approved[0].household_member_id,
      membership_status: approved[0].membership_status,
      reviewed_at: approved[0].reviewed_at,
    },
  });
}