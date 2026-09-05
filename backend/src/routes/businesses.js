import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

const BUSINESS_KINDS = new Set([
  "storefront",
  "professional_service",
  "visit_service",
  "lesson",
  "online_seller",
  "other",
]);

async function getResidentContext(request, env) {
  let auth;

  try {
    auth = await verifyAuthToken(request, env);
  } catch {
    auth = null;
  }

  if (!auth?.sub) {
    return {
      error: json(
        { ok: false, error: "UNAUTHORIZED" },
        401
      ),
    };
  }

  const sql = getDb(env.DATABASE_URL);

  const rows = await sql`
    SELECT
      u.id AS user_id,
      c.id AS complex_id

    FROM users u

    JOIN user_roles ur
      ON ur.user_id = u.id
     AND ur.role = 'resident'

    JOIN household_members hm
      ON hm.user_id = u.id
     AND hm.membership_status = 'verified'

    JOIN households h
      ON h.id = hm.household_id

    JOIN buildings b
      ON b.id = h.building_id

    JOIN complexes c
      ON c.id = b.complex_id

    WHERE u.auth_provider = 'neon_auth'
      AND u.auth_subject = ${String(auth.sub)}
      AND u.account_status = 'active'
      AND c.slug = 'banglim-myeongji-roadhill'

    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      error: json(
        {
          ok: false,
          error: "VERIFIED_RESIDENT_REQUIRED",
        },
        403
      ),
    };
  }

  return {
    sql,
    userId: rows[0].user_id,
    complexId: rows[0].complex_id,
  };
}

export async function handleBusinesses(request, env) {
  const context =
    await getResidentContext(request, env);

  if (context.error) {
    return context.error;
  }

  const {
    sql,
    userId,
    complexId,
  } = context;

  if (request.method === "GET") {
    const url = new URL(request.url);

    const category =
      String(
        url.searchParams.get("category") ?? ""
      ).trim();

    const filter =
      String(
        url.searchParams.get("filter") ?? ""
      ).trim();

    const q =
      String(
        url.searchParams.get("q") ?? ""
      ).trim();

    const searchPattern =
      `%${q}%`;

    const rows = await sql`
      SELECT
        biz.id,
        biz.public_slug,
        biz.name,
        biz.business_kind,
        biz.short_intro,
        biz.description,
        biz.address_text,
        biz.service_area_text,
        biz.phone,
        biz.contact_url,
        biz.updated_at,

        bc.slug AS category_slug,
        bc.name AS category_name,
        bc.filter_key,

        rel.relationship_type,

        EXISTS (
          SELECT 1
          FROM saved_businesses sb
          WHERE sb.user_id = ${userId}
            AND sb.business_id = biz.id
        ) AS saved,

        EXISTS (
          SELECT 1
          FROM business_benefits bb
          WHERE bb.business_id = biz.id
            AND bb.status = 'active'
            AND (
              bb.valid_from IS NULL
              OR bb.valid_from <= NOW()
            )
            AND (
              bb.valid_until IS NULL
              OR bb.valid_until >= NOW()
            )
        ) AS has_active_benefit

      FROM businesses biz

      JOIN business_complex_relationships rel
        ON rel.business_id = biz.id
       AND rel.complex_id = ${complexId}
       AND rel.verification_status = 'verified'

      LEFT JOIN business_categories bc
        ON bc.id = biz.category_id

      WHERE biz.approval_status = 'approved'

        AND (
          ${category} = ''
          OR bc.slug = ${category}
        )

        AND (
          ${filter} = ''
          OR ${filter} = 'all'
          OR bc.filter_key = ${filter}
        )

        AND (
          ${q} = ''
          OR biz.name ILIKE ${searchPattern}
          OR COALESCE(
            biz.short_intro,
            ''
          ) ILIKE ${searchPattern}
          OR COALESCE(
            biz.description,
            ''
          ) ILIKE ${searchPattern}
          OR COALESCE(
            biz.service_area_text,
            ''
          ) ILIKE ${searchPattern}
          OR COALESCE(
            bc.name,
            ''
          ) ILIKE ${searchPattern}
        )

      ORDER BY
        CASE rel.relationship_type
          WHEN 'current_resident' THEN 1
          WHEN 'resident_family' THEN 2
          WHEN 'neighbor_complex_resident' THEN 3
          WHEN 'local_partner' THEN 4
          ELSE 99
        END,
        biz.updated_at DESC,
        biz.name
    `;

    return json({
      ok: true,
      data: {
        count: rows.length,
        query: q || null,
        category: category || null,
        filter: filter || null,
        businesses: rows,
      },
    });
  }

  if (request.method === "POST") {
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        { ok: false, error: "INVALID_JSON" },
        400
      );
    }

    const name =
      String(body?.name ?? "").trim();

    const businessKind =
      String(
        body?.business_kind ?? ""
      ).trim();

    const categorySlug =
      String(
        body?.category_slug ?? "other"
      ).trim();

    if (!name) {
      return json(
        {
          ok: false,
          error: "BUSINESS_NAME_REQUIRED",
        },
        400
      );
    }

    if (!BUSINESS_KINDS.has(businessKind)) {
      return json(
        {
          ok: false,
          error: "INVALID_BUSINESS_KIND",
        },
        400
      );
    }

    const created = await sql`
      WITH selected_category AS (
        SELECT id
        FROM business_categories
        WHERE slug = ${categorySlug}
          AND is_active = TRUE
        LIMIT 1
      ),

      new_business AS (
        INSERT INTO businesses (
          name,
          business_kind,
          category_id,
          short_intro,
          description,
          address_text,
          service_area_text,
          phone,
          contact_url,
          approval_status
        )

        SELECT
          ${name},
          ${businessKind},
          id,
          ${body?.short_intro ?? null},
          ${body?.description ?? null},
          ${body?.address_text ?? null},
          ${body?.service_area_text ?? null},
          ${body?.phone ?? null},
          ${body?.contact_url ?? null},
          'pending'

        FROM selected_category

        RETURNING
          id,
          public_slug,
          name,
          business_kind,
          category_id,
          approval_status,
          created_at
      ),

      owner_link AS (
        INSERT INTO business_owners (
          business_id,
          user_id,
          owner_role
        )

        SELECT
          id,
          ${userId},
          'owner'

        FROM new_business

        RETURNING business_id
      ),

      owner_role AS (
        INSERT INTO user_roles (
          user_id,
          role
        )

        SELECT
          ${userId},
          'business_owner'

        FROM new_business

        ON CONFLICT (user_id, role)
        DO NOTHING
      ),

      complex_relationship AS (
        INSERT INTO business_complex_relationships (
          business_id,
          complex_id,
          relationship_type,
          verified_resident_user_id,
          verification_status,
          verified_at
        )

        SELECT
          id,
          ${complexId},
          'current_resident',
          ${userId},
          'verified',
          NOW()

        FROM new_business

        RETURNING business_id
      )

      SELECT
        nb.id,
        nb.public_slug,
        nb.name,
        nb.business_kind,
        nb.approval_status,
        nb.created_at,
        bc.slug AS category_slug,
        bc.name AS category_name,
        bc.filter_key

      FROM new_business nb

      JOIN business_categories bc
        ON bc.id = nb.category_id
    `;

    if (created.length === 0) {
      return json(
        {
          ok: false,
          error: "INVALID_CATEGORY",
        },
        400
      );
    }

    return json(
      {
        ok: true,
        data: created[0],
      },
      201
    );
  }

  return json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    405
  );
}