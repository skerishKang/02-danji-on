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

const BENEFIT_STATUSES = new Set([
  "draft",
  "active",
  "paused",
]);

function nullableText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

async function getActiveUser(request, env) {
  const auth = await verifyAuthToken(request, env);

  if (!auth?.sub) {
    return {
      error: json(
        {
          ok: false,
          error: "UNAUTHORIZED",
        },
        401
      ),
    };
  }

  const sql = getDb(env.DATABASE_URL);

  const users = await sql`
    SELECT id
    FROM users
    WHERE auth_provider = 'neon_auth'
      AND auth_subject = ${String(auth.sub)}
      AND account_status = 'active'
    LIMIT 1
  `;

  if (users.length === 0) {
    return {
      error: json(
        {
          ok: false,
          error: "USER_NOT_FOUND",
        },
        404
      ),
    };
  }

  return {
    sql,
    userId: users[0].id,
  };
}

async function getVerifiedResident(request, env) {
  const auth = await verifyAuthToken(request, env);

  if (!auth?.sub) {
    return {
      error: json(
        {
          ok: false,
          error: "UNAUTHORIZED",
        },
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
    SELECT
      biz.id,
      biz.name,
      biz.approval_status
    FROM businesses biz
    JOIN business_owners bo
      ON bo.business_id = biz.id
    WHERE biz.id = ${businessId}
      AND bo.user_id = ${context.userId}
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

  return {
    ...context,
    business: rows[0],
  };
}

export async function handleBusinessCategories(
  request,
  env
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const sql = getDb(env.DATABASE_URL);

  const rows = await sql`
    SELECT
      slug,
      name,
      sort_order
    FROM business_categories
    WHERE is_active = TRUE
    ORDER BY sort_order, name
  `;

  return json({
    ok: true,
    data: {
      count: rows.length,
      categories: rows,
    },
  });
}

export async function handleMyBusinesses(
  request,
  env
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const context = await getActiveUser(request, env);

  if (context.error) {
    return context.error;
  }

  const rows = await context.sql`
    SELECT
      biz.id,
      biz.name,
      biz.business_kind,
      biz.short_intro,
      biz.approval_status,
      biz.created_at,
      biz.updated_at,

      bc.slug AS category_slug,
      bc.name AS category_name,

      bo.owner_role,

      rel.relationship_type,
      rel.verification_status

    FROM businesses biz

    JOIN business_owners bo
      ON bo.business_id = biz.id
     AND bo.user_id = ${context.userId}

    LEFT JOIN business_categories bc
      ON bc.id = biz.category_id

    LEFT JOIN business_complex_relationships rel
      ON rel.business_id = biz.id

    ORDER BY biz.created_at DESC, biz.id DESC
  `;

  return json({
    ok: true,
    data: {
      count: rows.length,
      businesses: rows,
    },
  });
}

export async function handleBusinessDetail(
  request,
  env,
  businessId
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  if (!/^\d+$/.test(String(businessId))) {
    return json(
      {
        ok: false,
        error: "INVALID_BUSINESS_ID",
      },
      400
    );
  }

  const context = await getVerifiedResident(
    request,
    env
  );

  if (context.error) {
    return context.error;
  }

  const rows = await context.sql`
    SELECT
      biz.id,
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

      rel.relationship_type,

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
      ) AS benefits

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
      {
        ok: false,
        error: "BUSINESS_NOT_FOUND",
      },
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

export async function handleUpdateMyBusiness(
  request,
  env,
  businessId
) {
  if (request.method !== "PATCH") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  if (!/^\d+$/.test(String(businessId))) {
    return json(
      {
        ok: false,
        error: "INVALID_BUSINESS_ID",
      },
      400
    );
  }

  const context = await requireBusinessOwner(
    request,
    env,
    businessId
  );

  if (context.error) {
    return context.error;
  }

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

  const has = (key) =>
    Object.prototype.hasOwnProperty.call(body, key);

  const hasName = has("name");
  const hasKind = has("business_kind");
  const hasCategory = has("category_slug");
  const hasShortIntro = has("short_intro");
  const hasDescription = has("description");
  const hasAddress = has("address_text");
  const hasServiceArea = has("service_area_text");
  const hasPhone = has("phone");
  const hasContactUrl = has("contact_url");

  if (
    !hasName &&
    !hasKind &&
    !hasCategory &&
    !hasShortIntro &&
    !hasDescription &&
    !hasAddress &&
    !hasServiceArea &&
    !hasPhone &&
    !hasContactUrl
  ) {
    return json(
      {
        ok: false,
        error: "NO_UPDATABLE_FIELDS",
      },
      400
    );
  }

  const name = hasName
    ? String(body.name ?? "").trim()
    : null;

  if (hasName && !name) {
    return json(
      {
        ok: false,
        error: "BUSINESS_NAME_REQUIRED",
      },
      400
    );
  }

  const businessKind = hasKind
    ? String(body.business_kind ?? "").trim()
    : null;

  if (
    hasKind &&
    !BUSINESS_KINDS.has(businessKind)
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_BUSINESS_KIND",
      },
      400
    );
  }

  let categoryId = null;

  if (hasCategory) {
    const categorySlug =
      String(body.category_slug ?? "").trim();

    const categories = await context.sql`
      SELECT id
      FROM business_categories
      WHERE slug = ${categorySlug}
        AND is_active = TRUE
      LIMIT 1
    `;

    if (categories.length === 0) {
      return json(
        {
          ok: false,
          error: "INVALID_CATEGORY",
        },
        400
      );
    }

    categoryId = categories[0].id;
  }

  const rows = await context.sql`
    UPDATE businesses
    SET
      name =
        CASE
          WHEN ${hasName}
          THEN ${name}
          ELSE name
        END,

      business_kind =
        CASE
          WHEN ${hasKind}
          THEN ${businessKind}
          ELSE business_kind
        END,

      category_id =
        CASE
          WHEN ${hasCategory}
          THEN ${categoryId}
          ELSE category_id
        END,

      short_intro =
        CASE
          WHEN ${hasShortIntro}
          THEN ${nullableText(body.short_intro)}
          ELSE short_intro
        END,

      description =
        CASE
          WHEN ${hasDescription}
          THEN ${nullableText(body.description)}
          ELSE description
        END,

      address_text =
        CASE
          WHEN ${hasAddress}
          THEN ${nullableText(body.address_text)}
          ELSE address_text
        END,

      service_area_text =
        CASE
          WHEN ${hasServiceArea}
          THEN ${nullableText(body.service_area_text)}
          ELSE service_area_text
        END,

      phone =
        CASE
          WHEN ${hasPhone}
          THEN ${nullableText(body.phone)}
          ELSE phone
        END,

      contact_url =
        CASE
          WHEN ${hasContactUrl}
          THEN ${nullableText(body.contact_url)}
          ELSE contact_url
        END,

      approval_status =
        CASE
          WHEN approval_status = 'approved'
          THEN 'pending'
          ELSE approval_status
        END,

      reviewed_at =
        CASE
          WHEN approval_status = 'approved'
          THEN NULL
          ELSE reviewed_at
        END,

      reviewed_by_user_id =
        CASE
          WHEN approval_status = 'approved'
          THEN NULL
          ELSE reviewed_by_user_id
        END,

      updated_at = NOW()

    WHERE id = ${businessId}

    RETURNING
      id,
      name,
      business_kind,
      approval_status,
      updated_at
  `;

  return json({
    ok: true,
    data: rows[0],
  });
}

export async function handleBusinessHours(
  request,
  env,
  businessId
) {
  if (request.method !== "PUT") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  if (!/^\d+$/.test(String(businessId))) {
    return json(
      {
        ok: false,
        error: "INVALID_BUSINESS_ID",
      },
      400
    );
  }

  const context = await requireBusinessOwner(
    request,
    env,
    businessId
  );

  if (context.error) {
    return context.error;
  }

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

  const hours = body?.hours;

  if (
    !Array.isArray(hours) ||
    hours.length > 7
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_HOURS",
      },
      400
    );
  }

  const seenDays = new Set();
  const timePattern =
    /^([01]\d|2[0-3]):[0-5]\d$/;

  const normalized = [];

  for (const item of hours) {
    const day = Number(item?.day_of_week);
    const isClosed = Boolean(item?.is_closed);

    if (
      !Number.isInteger(day) ||
      day < 0 ||
      day > 6 ||
      seenDays.has(day)
    ) {
      return json(
        {
          ok: false,
          error: "INVALID_HOURS",
        },
        400
      );
    }

    seenDays.add(day);

    const openTime = isClosed
      ? null
      : String(item?.open_time ?? "");

    const closeTime = isClosed
      ? null
      : String(item?.close_time ?? "");

    if (
      !isClosed &&
      (
        !timePattern.test(openTime) ||
        !timePattern.test(closeTime)
      )
    ) {
      return json(
        {
          ok: false,
          error: "INVALID_HOURS",
        },
        400
      );
    }

    normalized.push({
      day_of_week: day,
      open_time: openTime,
      close_time: closeTime,
      is_closed: isClosed,
    });
  }

  const rows = await context.sql`
    WITH deleted AS (
      DELETE FROM business_hours
      WHERE business_id = ${businessId}
      RETURNING business_id
    ),

    inserted AS (
      INSERT INTO business_hours (
        business_id,
        day_of_week,
        open_time,
        close_time,
        is_closed
      )

      SELECT
        ${businessId},
        x.day_of_week::smallint,

        CASE
          WHEN x.is_closed
          THEN NULL
          ELSE x.open_time::time
        END,

        CASE
          WHEN x.is_closed
          THEN NULL
          ELSE x.close_time::time
        END,

        x.is_closed

      FROM jsonb_to_recordset(
        ${JSON.stringify(normalized)}::jsonb
      ) AS x(
        day_of_week integer,
        open_time text,
        close_time text,
        is_closed boolean
      )

      RETURNING
        day_of_week,
        open_time,
        close_time,
        is_closed
    )

    SELECT *
    FROM inserted
    ORDER BY day_of_week
  `;

  return json({
    ok: true,
    data: {
      business_id: String(businessId),
      hours: rows,
    },
  });
}

export async function handleBusinessBenefits(
  request,
  env,
  businessId
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

  if (!/^\d+$/.test(String(businessId))) {
    return json(
      {
        ok: false,
        error: "INVALID_BUSINESS_ID",
      },
      400
    );
  }

  const context = await requireBusinessOwner(
    request,
    env,
    businessId
  );

  if (context.error) {
    return context.error;
  }

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

  const title =
    String(body?.title ?? "").trim();

  if (!title) {
    return json(
      {
        ok: false,
        error: "BENEFIT_TITLE_REQUIRED",
      },
      400
    );
  }

  const status =
    String(body?.status ?? "active").trim();

  if (!BENEFIT_STATUSES.has(status)) {
    return json(
      {
        ok: false,
        error: "INVALID_BENEFIT_STATUS",
      },
      400
    );
  }

  const validFrom =
    nullableText(body?.valid_from);

  const validUntil =
    nullableText(body?.valid_until);

  if (
    validFrom &&
    Number.isNaN(Date.parse(validFrom))
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_VALID_FROM",
      },
      400
    );
  }

  if (
    validUntil &&
    Number.isNaN(Date.parse(validUntil))
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_VALID_UNTIL",
      },
      400
    );
  }

  if (
    validFrom &&
    validUntil &&
    new Date(validUntil) < new Date(validFrom)
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_BENEFIT_PERIOD",
      },
      400
    );
  }

  const rows = await context.sql`
    INSERT INTO business_benefits (
      business_id,
      title,
      description,
      valid_from,
      valid_until,
      status
    )
    VALUES (
      ${businessId},
      ${title},
      ${nullableText(body?.description)},
      ${validFrom}::timestamptz,
      ${validUntil}::timestamptz,
      ${status}
    )
    RETURNING
      id,
      business_id,
      title,
      description,
      valid_from,
      valid_until,
      status,
      created_at
  `;

  return json(
    {
      ok: true,
      data: rows[0],
    },
    201
  );
}