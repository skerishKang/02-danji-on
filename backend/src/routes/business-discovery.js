import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

const PILOT_COMPLEX_SLUG =
  "banglim-myeongji-roadhill";

async function getVerifiedResident(request, env) {
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
      AND c.slug = ${PILOT_COMPLEX_SLUG}

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

async function getActiveUser(request, env) {
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
    SELECT id
    FROM users
    WHERE auth_provider = 'neon_auth'
      AND auth_subject = ${String(auth.sub)}
      AND account_status = 'active'
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      error: json(
        { ok: false, error: "USER_NOT_FOUND" },
        404
      ),
    };
  }

  return {
    sql,
    userId: rows[0].id,
  };
}

async function requireBusinessOwner(
  request,
  env,
  businessId
) {
  const context = await getActiveUser(request, env);

  if (context.error) {
    return context;
  }

  const rows = await context.sql`
    SELECT 1
    FROM business_owners
    WHERE business_id = ${businessId}
      AND user_id = ${context.userId}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      error: json(
        {
          ok: false,
          error: "BUSINESS_OWNER_REQUIRED",
        },
        403
      ),
    };
  }

  return context;
}


// ==========================================================
// HOME FEATURED SHOPS
// ==========================================================

export async function handleHome(request, env) {
  if (request.method !== "GET") {
    return json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  const sql = getDb(env.DATABASE_URL);

  const complexRows = await sql`
    SELECT id, slug, name
    FROM complexes
    WHERE slug = ${PILOT_COMPLEX_SLUG}
      AND status = 'pilot'
    LIMIT 1
  `;

  if (complexRows.length === 0) {
    return json(
      { ok: false, error: "COMPLEX_NOT_FOUND" },
      404
    );
  }

  const complex = complexRows[0];

  const featured = await sql`
    SELECT
      biz.id,
      biz.public_slug,
      biz.name,
      biz.short_intro AS summary,
      biz.business_kind,

      bc.slug AS category_slug,
      bc.name AS category_name,
      bc.filter_key,

      rel.relationship_type,

      fb.scene_label,
      fb.sort_order,

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

    FROM featured_businesses fb

    JOIN businesses biz
      ON biz.id = fb.business_id
     AND biz.approval_status = 'approved'

    JOIN business_complex_relationships rel
      ON rel.business_id = biz.id
     AND rel.complex_id = fb.complex_id
     AND rel.verification_status = 'verified'

    LEFT JOIN business_categories bc
      ON bc.id = biz.category_id

    WHERE fb.complex_id = ${complex.id}
      AND fb.is_active = TRUE

    ORDER BY fb.sort_order, biz.id
  `;

  return json({
    ok: true,
    data: {
      apartment: {
        id: complex.id,
        slug: complex.slug,
        name: complex.name,
      },

      viewer: {
        mode: "guest",
      },

      featured_shops: featured,
    },
  });
}


// ==========================================================
// BUSINESS DETAIL
// ==========================================================

export async function handleBusinessDetail(
  request,
  env,
  businessId
) {
  if (request.method !== "GET") {
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

  const context =
    await getVerifiedResident(request, env);

  if (context.error) {
    return context.error;
  }

  const rows = await context.sql`
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

      bc.slug AS category_slug,
      bc.name AS category_name,
      bc.filter_key,

      rel.relationship_type,

      EXISTS (
        SELECT 1
        FROM saved_businesses sb
        WHERE sb.business_id = biz.id
          AND sb.user_id = ${context.userId}
      ) AS saved,

      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'day_of_week', bh.day_of_week,
              'open_time', bh.open_time,
              'close_time', bh.close_time,
              'is_closed', bh.is_closed
            )
            ORDER BY bh.day_of_week
          )
          FROM business_hours bh
          WHERE bh.business_id = biz.id
        ),
        '[]'::jsonb
      ) AS hours,

      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bs.id,
              'title', bs.title,
              'price_text', bs.price_text,
              'description', bs.description
            )
            ORDER BY bs.sort_order, bs.id
          )
          FROM business_services bs
          WHERE bs.business_id = biz.id
            AND bs.is_active = TRUE
        ),
        '[]'::jsonb
      ) AS services,

      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bn.id,
              'title', bn.title,
              'body', bn.body,
              'published_at', bn.published_at
            )
            ORDER BY bn.published_at DESC, bn.id DESC
          )
          FROM business_news bn
          WHERE bn.business_id = biz.id
            AND bn.status = 'published'
        ),
        '[]'::jsonb
      ) AS news,

      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', bb.id,
              'title', bb.title,
              'description', bb.description,
              'valid_from', bb.valid_from,
              'valid_until', bb.valid_until
            )
            ORDER BY bb.created_at DESC
          )
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
        ),
        '[]'::jsonb
      ) AS benefits,

      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', br.id,
              'body', br.body,
              'created_at', br.created_at,
              'updated_at', br.updated_at,
              'author',
                jsonb_build_object(
                  'id', ru.id,
                  'display_name', ru.display_name
                ),
              'reply',
                CASE
                  WHEN brr.id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'id', brr.id,
                    'body', brr.body,
                    'created_at', brr.created_at
                  )
                END
            )
            ORDER BY br.created_at DESC
          )

          FROM business_reviews br

          JOIN users ru
            ON ru.id = br.author_user_id

          LEFT JOIN business_review_replies brr
            ON brr.review_id = br.id
           AND brr.status = 'active'

          WHERE br.business_id = biz.id
            AND br.status = 'active'
        ),
        '[]'::jsonb
      ) AS reviews

    FROM businesses biz

    JOIN business_complex_relationships rel
      ON rel.business_id = biz.id
     AND rel.complex_id = ${context.complexId}
     AND rel.verification_status = 'verified'

    LEFT JOIN business_categories bc
      ON bc.id = biz.category_id

    WHERE biz.id = ${businessId}
      AND biz.approval_status = 'approved'

    LIMIT 1
  `;

  if (rows.length === 0) {
    return json(
      { ok: false, error: "BUSINESS_NOT_FOUND" },
      404
    );
  }

  return json({
    ok: true,
    data: {
      business: rows[0],
    },
  });
}


// ==========================================================
// PERMANENT SHARE SLUG
// ==========================================================

export async function handleBusinessBySlug(
  request,
  env,
  publicSlug
) {
  if (request.method !== "GET") {
    return json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  const sql = getDb(env.DATABASE_URL);

  const rows = await sql`
    SELECT id
    FROM businesses
    WHERE public_slug = ${String(publicSlug)}
      AND approval_status = 'approved'
    LIMIT 1
  `;

  if (rows.length === 0) {
    return json(
      { ok: false, error: "BUSINESS_NOT_FOUND" },
      404
    );
  }

  return handleBusinessDetail(
    request,
    env,
    rows[0].id
  );
}


// ==========================================================
// SAVE / UNSAVE
// ==========================================================

export async function handleBusinessSave(
  request,
  env,
  businessId
) {
  if (!/^\d+$/.test(String(businessId))) {
    return json(
      { ok: false, error: "INVALID_BUSINESS_ID" },
      400
    );
  }

  const context =
    await getVerifiedResident(request, env);

  if (context.error) {
    return context.error;
  }

  const available = await context.sql`
    SELECT biz.id
    FROM businesses biz

    JOIN business_complex_relationships rel
      ON rel.business_id = biz.id
     AND rel.complex_id = ${context.complexId}
     AND rel.verification_status = 'verified'

    WHERE biz.id = ${businessId}
      AND biz.approval_status = 'approved'

    LIMIT 1
  `;

  if (available.length === 0) {
    return json(
      { ok: false, error: "BUSINESS_NOT_FOUND" },
      404
    );
  }

  if (request.method === "POST") {
    await context.sql`
      INSERT INTO saved_businesses (
        user_id,
        business_id
      )
      VALUES (
        ${context.userId},
        ${businessId}
      )
      ON CONFLICT (user_id, business_id)
      DO NOTHING
    `;

    return json({
      ok: true,
      data: {
        business_id: String(businessId),
        saved: true,
      },
    });
  }

  if (request.method === "DELETE") {
    await context.sql`
      DELETE FROM saved_businesses
      WHERE user_id = ${context.userId}
        AND business_id = ${businessId}
    `;

    return json({
      ok: true,
      data: {
        business_id: String(businessId),
        saved: false,
      },
    });
  }

  return json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    405
  );
}


export async function handleMySavedBusinesses(
  request,
  env
) {
  if (request.method !== "GET") {
    return json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  const context =
    await getVerifiedResident(request, env);

  if (context.error) {
    return context.error;
  }

  const rows = await context.sql`
    SELECT
      biz.id,
      biz.public_slug,
      biz.name,
      biz.short_intro,
      biz.business_kind,

      bc.slug AS category_slug,
      bc.name AS category_name,
      bc.filter_key,

      sb.created_at AS saved_at

    FROM saved_businesses sb

    JOIN businesses biz
      ON biz.id = sb.business_id
     AND biz.approval_status = 'approved'

    JOIN business_complex_relationships rel
      ON rel.business_id = biz.id
     AND rel.complex_id = ${context.complexId}
     AND rel.verification_status = 'verified'

    LEFT JOIN business_categories bc
      ON bc.id = biz.category_id

    WHERE sb.user_id = ${context.userId}

    ORDER BY sb.created_at DESC
  `;

  return json({
    ok: true,
    data: {
      count: rows.length,
      businesses: rows,
    },
  });
}


// ==========================================================
// REVIEWS
// ==========================================================

export async function handleBusinessReviews(
  request,
  env,
  businessId
) {
  if (!/^\d+$/.test(String(businessId))) {
    return json(
      { ok: false, error: "INVALID_BUSINESS_ID" },
      400
    );
  }

  const context =
    await getVerifiedResident(request, env);

  if (context.error) {
    return context.error;
  }

  const businessRows = await context.sql`
    SELECT biz.id
    FROM businesses biz

    JOIN business_complex_relationships rel
      ON rel.business_id = biz.id
     AND rel.complex_id = ${context.complexId}
     AND rel.verification_status = 'verified'

    WHERE biz.id = ${businessId}
      AND biz.approval_status = 'approved'

    LIMIT 1
  `;

  if (businessRows.length === 0) {
    return json(
      { ok: false, error: "BUSINESS_NOT_FOUND" },
      404
    );
  }

  if (request.method === "GET") {
    const rows = await context.sql`
      SELECT
        br.id,
        br.body,
        br.author_user_id,
        br.created_at,
        br.updated_at,

        u.display_name AS author_display_name,

        brr.id AS reply_id,
        brr.body AS reply_body,
        brr.created_at AS reply_created_at

      FROM business_reviews br

      JOIN users u
        ON u.id = br.author_user_id

      LEFT JOIN business_review_replies brr
        ON brr.review_id = br.id
       AND brr.status = 'active'

      WHERE br.business_id = ${businessId}
        AND br.status = 'active'

      ORDER BY br.created_at DESC
    `;

    return json({
      ok: true,
      data: {
        count: rows.length,
        reviews: rows,
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

    const reviewBody =
      String(body?.body ?? "").trim();

    if (!reviewBody) {
      return json(
        { ok: false, error: "REVIEW_BODY_REQUIRED" },
        400
      );
    }

    if (reviewBody.length > 2000) {
      return json(
        { ok: false, error: "REVIEW_TOO_LONG" },
        400
      );
    }

    const rows = await context.sql`
      INSERT INTO business_reviews (
        business_id,
        author_user_id,
        body
      )
      VALUES (
        ${businessId},
        ${context.userId},
        ${reviewBody}
      )
      RETURNING
        id,
        business_id,
        author_user_id,
        body,
        status,
        created_at,
        updated_at
    `;

    return json(
      {
        ok: true,
        data: rows[0],
      },
      201
    );
  }

  return json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    405
  );
}


export async function handleMyReviewMutation(
  request,
  env,
  reviewId
) {
  if (!/^\d+$/.test(String(reviewId))) {
    return json(
      { ok: false, error: "INVALID_REVIEW_ID" },
      400
    );
  }

  const context =
    await getVerifiedResident(request, env);

  if (context.error) {
    return context.error;
  }

  if (request.method === "PATCH") {
    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        { ok: false, error: "INVALID_JSON" },
        400
      );
    }

    const reviewBody =
      String(body?.body ?? "").trim();

    if (!reviewBody) {
      return json(
        { ok: false, error: "REVIEW_BODY_REQUIRED" },
        400
      );
    }

    if (reviewBody.length > 2000) {
      return json(
        { ok: false, error: "REVIEW_TOO_LONG" },
        400
      );
    }

    const rows = await context.sql`
      UPDATE business_reviews
      SET
        body = ${reviewBody},
        updated_at = NOW()

      WHERE id = ${reviewId}
        AND author_user_id = ${context.userId}
        AND status = 'active'

      RETURNING
        id,
        business_id,
        body,
        updated_at
    `;

    if (rows.length === 0) {
      return json(
        {
          ok: false,
          error: "REVIEW_NOT_FOUND_OR_NOT_OWNER",
        },
        404
      );
    }

    return json({
      ok: true,
      data: rows[0],
    });
  }

  if (request.method === "DELETE") {
    const rows = await context.sql`
      UPDATE business_reviews
      SET
        status = 'deleted',
        updated_at = NOW()

      WHERE id = ${reviewId}
        AND author_user_id = ${context.userId}
        AND status = 'active'

      RETURNING id
    `;

    if (rows.length === 0) {
      return json(
        {
          ok: false,
          error: "REVIEW_NOT_FOUND_OR_NOT_OWNER",
        },
        404
      );
    }

    return json({
      ok: true,
      data: {
        review_id: String(reviewId),
        deleted: true,
      },
    });
  }

  return json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    405
  );
}


// ==========================================================
// BUSINESS OWNER REPLY
// ==========================================================

export async function handleReviewReply(
  request,
  env,
  reviewId
) {
  if (request.method !== "POST") {
    return json(
      { ok: false, error: "METHOD_NOT_ALLOWED" },
      405
    );
  }

  if (!/^\d+$/.test(String(reviewId))) {
    return json(
      { ok: false, error: "INVALID_REVIEW_ID" },
      400
    );
  }

  const active = await getActiveUser(request, env);

  if (active.error) {
    return active.error;
  }

  const reviewRows = await active.sql`
    SELECT
      br.id,
      br.business_id

    FROM business_reviews br

    WHERE br.id = ${reviewId}
      AND br.status = 'active'

    LIMIT 1
  `;

  if (reviewRows.length === 0) {
    return json(
      { ok: false, error: "REVIEW_NOT_FOUND" },
      404
    );
  }

  const businessId =
    reviewRows[0].business_id;

  const owner =
    await requireBusinessOwner(
      request,
      env,
      businessId
    );

  if (owner.error) {
    return owner.error;
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      { ok: false, error: "INVALID_JSON" },
      400
    );
  }

  const replyBody =
    String(body?.body ?? "").trim();

  if (!replyBody) {
    return json(
      { ok: false, error: "REPLY_BODY_REQUIRED" },
      400
    );
  }

  if (replyBody.length > 2000) {
    return json(
      { ok: false, error: "REPLY_TOO_LONG" },
      400
    );
  }

  const rows = await owner.sql`
    INSERT INTO business_review_replies (
      review_id,
      author_user_id,
      body,
      status
    )
    VALUES (
      ${reviewId},
      ${owner.userId},
      ${replyBody},
      'active'
    )

    ON CONFLICT (review_id)
    DO UPDATE SET
      author_user_id = EXCLUDED.author_user_id,
      body = EXCLUDED.body,
      status = 'active',
      updated_at = NOW()

    RETURNING
      id,
      review_id,
      author_user_id,
      body,
      status,
      created_at,
      updated_at
  `;

  return json({
    ok: true,
    data: rows[0],
  });
}