import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

async function getReviewer(request, env) {
  const auth = await verifyAuthToken(request, env);

  if (!auth?.sub) {
    return {
      error: json({ ok: false, error: "UNAUTHORIZED" }, 401),
    };
  }

  const sql = getDb(env.DATABASE_URL);

  const rows = await sql`
    SELECT
      u.id,
      ur.role
    FROM users u
    JOIN user_roles ur
      ON ur.user_id = u.id
    WHERE u.auth_provider = 'neon_auth'
      AND u.auth_subject = ${String(auth.sub)}
      AND u.account_status = 'active'
      AND ur.role IN ('operator', 'admin')
    ORDER BY
      CASE
        WHEN ur.role = 'admin' THEN 1
        ELSE 2
      END
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      error: json({ ok: false, error: "FORBIDDEN" }, 403),
    };
  }

  return {
    sql,
    reviewerId: rows[0].id,
    reviewerRole: rows[0].role,
  };
}

export async function handleAdminBusinessList(request, env) {
  if (request.method !== "GET") {
    return json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  const context = await getReviewer(request, env);

  if (context.error) {
    return context.error;
  }

  const rows = await context.sql`
    SELECT
      biz.id,
      biz.name,
      biz.business_kind,
      biz.short_intro,
      biz.address_text,
      biz.service_area_text,
      biz.approval_status,
      biz.created_at,

      bc.slug AS category_slug,
      bc.name AS category_name,

      rel.relationship_type,

      ARRAY_AGG(
        DISTINCT u.display_name
      ) FILTER (
        WHERE u.id IS NOT NULL
      ) AS owner_names

    FROM businesses biz

    LEFT JOIN business_categories bc
      ON bc.id = biz.category_id

    LEFT JOIN business_complex_relationships rel
      ON rel.business_id = biz.id

    LEFT JOIN business_owners bo
      ON bo.business_id = biz.id

    LEFT JOIN users u
      ON u.id = bo.user_id

    WHERE biz.approval_status = 'pending'

    GROUP BY
      biz.id,
      bc.slug,
      bc.name,
      rel.relationship_type

    ORDER BY biz.created_at ASC, biz.id ASC
  `;

  return json({
    ok: true,
    data: {
      count: rows.length,
      businesses: rows,
    },
  });
}

export async function handleApproveBusiness(
  request,
  env,
  businessId
) {
  if (request.method !== "POST") {
    return json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  if (!/^\d+$/.test(String(businessId))) {
    return json(
      { ok: false, error: "INVALID_BUSINESS_ID" },
      400
    );
  }

  const context = await getReviewer(request, env);

  if (context.error) {
    return context.error;
  }

  const { sql, reviewerId } = context;

  const approved = await sql`
    UPDATE businesses biz
    SET
      approval_status = 'approved',
      reviewed_at = NOW(),
      reviewed_by_user_id = ${reviewerId},
      updated_at = NOW()

    WHERE biz.id = ${businessId}
      AND biz.approval_status = 'pending'

      AND NOT EXISTS (
        SELECT 1
        FROM business_owners bo
        WHERE bo.business_id = biz.id
          AND bo.user_id = ${reviewerId}
      )

    RETURNING
      biz.id,
      biz.name,
      biz.approval_status,
      biz.reviewed_at
  `;

  if (approved.length > 0) {
    return json({
      ok: true,
      data: approved[0],
    });
  }

  const existing = await sql`
    SELECT
      biz.id,
      biz.approval_status,

      EXISTS (
        SELECT 1
        FROM business_owners bo
        WHERE bo.business_id = biz.id
          AND bo.user_id = ${reviewerId}
      ) AS is_own_business

    FROM businesses biz
    WHERE biz.id = ${businessId}
    LIMIT 1
  `;

  if (existing.length === 0) {
    return json(
      { ok: false, error: "BUSINESS_NOT_FOUND" },
      404
    );
  }

  if (
    existing[0].approval_status === "pending" &&
    existing[0].is_own_business
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
      error: "BUSINESS_NOT_PENDING",
      data: {
        business_id: existing[0].id,
        status: existing[0].approval_status,
      },
    },
    409
  );
}