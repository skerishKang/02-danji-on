import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

const PILOT_COMPLEX_SLUG =
  "banglim-myeongji-roadhill";

const OWNER_RELATIONS =
  new Set([
    "self",
    "co",
    "family",
    "etc",
  ]);

const REPORT_RELATIONS =
  new Set([
    "family",
    "neighbor",
    "nearby",
    "etc",
  ]);

function text(value) {
  return String(value ?? "").trim();
}

function nullableText(value) {
  const result = text(value);
  return result || null;
}

async function parseBody(request) {
  try {
    return {
      data: await request.json(),
    };
  } catch {
    return {
      error: json(
        {
          ok: false,
          error: "INVALID_JSON",
        },
        400
      ),
    };
  }
}


// ==========================================================
// VERIFIED RESIDENT
// ==========================================================

async function requireResident(
  request,
  env
) {
  let auth;

  try {
    auth =
      await verifyAuthToken(
        request,
        env
      );
  } catch {
    auth = null;
  }

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

  const sql =
    getDb(env.DATABASE_URL);

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
      AND u.auth_subject =
        ${String(auth.sub)}
      AND u.account_status = 'active'
      AND c.slug =
        ${PILOT_COMPLEX_SLUG}

    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      error: json(
        {
          ok: false,
          error:
            "VERIFIED_RESIDENT_REQUIRED",
        },
        403
      ),
    };
  }

  return {
    sql,
    userId:
      rows[0].user_id,
    complexId:
      rows[0].complex_id,
  };
}


// ==========================================================
// OPERATOR / ADMIN
// ==========================================================

async function requireOperator(
  request,
  env
) {
  let auth;

  try {
    auth =
      await verifyAuthToken(
        request,
        env
      );
  } catch {
    auth = null;
  }

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

  const sql =
    getDb(env.DATABASE_URL);

  const rows = await sql`
    SELECT DISTINCT
      u.id AS user_id

    FROM users u

    JOIN user_roles ur
      ON ur.user_id = u.id

    WHERE u.auth_provider = 'neon_auth'
      AND u.auth_subject =
        ${String(auth.sub)}
      AND u.account_status = 'active'
      AND ur.role IN (
        'operator',
        'admin'
      )

    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      error: json(
        {
          ok: false,
          error:
            "OPERATOR_OR_ADMIN_REQUIRED",
        },
        403
      ),
    };
  }

  return {
    sql,
    userId:
      rows[0].user_id,
  };
}


// ==========================================================
// VALIDATION
// ==========================================================

function validateOwner(body) {
  const relation =
    text(body?.relation_code);

  if (
    !OWNER_RELATIONS.has(
      relation
    )
  ) {
    return "INVALID_RELATION";
  }

  if (!text(body?.shop_name)) {
    return "SHOP_NAME_REQUIRED";
  }

  if (!text(body?.category_text)) {
    return "CATEGORY_REQUIRED";
  }

  if (!text(body?.hours_text)) {
    return "HOURS_REQUIRED";
  }

  if (
    !text(
      body?.service_price_text
    )
  ) {
    return "SERVICE_PRICE_REQUIRED";
  }

  if (
    !text(
      body?.location_use_text
    )
  ) {
    return "LOCATION_REQUIRED";
  }

  if (!text(body?.contact_text)) {
    return "CONTACT_REQUIRED";
  }

  if (
    relation === "etc" &&
    !text(body?.relation_detail)
  ) {
    return "RELATION_DETAIL_REQUIRED";
  }

  return null;
}


function validateReport(body) {
  const relation =
    text(body?.relation_code);

  if (
    !REPORT_RELATIONS.has(
      relation
    )
  ) {
    return "INVALID_RELATION";
  }

  if (!text(body?.shop_name)) {
    return "SHOP_NAME_REQUIRED";
  }

  if (!text(body?.report_what)) {
    return "REPORT_WHAT_REQUIRED";
  }

  if (
    !text(body?.report_location)
  ) {
    return "REPORT_LOCATION_REQUIRED";
  }

  if (
    !text(body?.report_reason)
  ) {
    return "REPORT_REASON_REQUIRED";
  }

  if (
    relation === "etc" &&
    !text(body?.relation_detail)
  ) {
    return "RELATION_DETAIL_REQUIRED";
  }

  return null;
}


// ==========================================================
// CREATE OWNER APPLICATION
// POST /api/shop-applications
// ==========================================================

export async function handleShopApplicationCreate(
  request,
  env
) {
  if (request.method !== "POST") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const context =
    await requireResident(
      request,
      env
    );

  if (context.error) {
    return context.error;
  }

  const parsed =
    await parseBody(request);

  if (parsed.error) {
    return parsed.error;
  }

  const body =
    parsed.data;

  const validationError =
    validateOwner(body);

  if (validationError) {
    return json(
      {
        ok: false,
        error:
          validationError,
      },
      400
    );
  }

  const rows =
    await context.sql`
      INSERT INTO business_applications (
        applicant_user_id,
        complex_id,
        application_mode,

        shop_name,
        relation_code,
        relation_detail,

        category_text,
        hours_text,
        service_price_text,
        location_use_text,
        benefit_text,
        contact_text,
        extra_intro,

        status,
        submitted_at
      )

      VALUES (
        ${context.userId},
        ${context.complexId},
        'owner',

        ${text(body.shop_name)},
        ${text(body.relation_code)},
        ${nullableText(
          body.relation_detail
        )},

        ${text(
          body.category_text
        )},

        ${text(
          body.hours_text
        )},

        ${text(
          body.service_price_text
        )},

        ${text(
          body.location_use_text
        )},

        ${nullableText(
          body.benefit_text
        )},

        ${text(
          body.contact_text
        )},

        ${nullableText(
          body.extra_intro
        )},

        'submitted',
        NOW()
      )

      RETURNING
        id,
        application_mode,
        shop_name,
        status,
        submitted_at,
        created_at
    `;

  const application =
    rows[0];

  await context.sql`
    INSERT INTO
      business_application_events (
        application_id,
        actor_user_id,
        from_status,
        to_status
      )

    VALUES (
      ${application.id},
      ${context.userId},
      NULL,
      'submitted'
    )
  `;

  return json(
    {
      ok: true,
      data: application,
    },
    201
  );
}


// ==========================================================
// CREATE REPORT
// POST /api/shop-reports
// ==========================================================

export async function handleShopReportCreate(
  request,
  env
) {
  if (request.method !== "POST") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const context =
    await requireResident(
      request,
      env
    );

  if (context.error) {
    return context.error;
  }

  const parsed =
    await parseBody(request);

  if (parsed.error) {
    return parsed.error;
  }

  const body =
    parsed.data;

  const validationError =
    validateReport(body);

  if (validationError) {
    return json(
      {
        ok: false,
        error:
          validationError,
      },
      400
    );
  }

  const rows =
    await context.sql`
      INSERT INTO business_applications (
        applicant_user_id,
        complex_id,
        application_mode,

        shop_name,
        relation_code,
        relation_detail,

        report_what,
        report_price,
        report_hours,
        report_location,
        report_reason,

        status,
        submitted_at
      )

      VALUES (
        ${context.userId},
        ${context.complexId},
        'report',

        ${text(body.shop_name)},
        ${text(body.relation_code)},
        ${nullableText(
          body.relation_detail
        )},

        ${text(
          body.report_what
        )},

        ${nullableText(
          body.report_price
        )},

        ${nullableText(
          body.report_hours
        )},

        ${text(
          body.report_location
        )},

        ${text(
          body.report_reason
        )},

        'submitted',
        NOW()
      )

      RETURNING
        id,
        application_mode,
        shop_name,
        status,
        submitted_at,
        created_at
    `;

  const application =
    rows[0];

  await context.sql`
    INSERT INTO
      business_application_events (
        application_id,
        actor_user_id,
        from_status,
        to_status
      )

    VALUES (
      ${application.id},
      ${context.userId},
      NULL,
      'submitted'
    )
  `;

  return json(
    {
      ok: true,
      data: application,
    },
    201
  );
}


// ==========================================================
// MY APPLICATIONS
// GET /api/me/shop-applications
// ==========================================================

export async function handleMyShopApplications(
  request,
  env
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const context =
    await requireResident(
      request,
      env
    );

  if (context.error) {
    return context.error;
  }

  const rows =
    await context.sql`
      SELECT
        ba.id,
        ba.application_mode,
        ba.shop_name,
        ba.relation_code,
        ba.relation_detail,

        ba.category_text,
        ba.hours_text,
        ba.service_price_text,
        ba.location_use_text,
        ba.benefit_text,
        ba.contact_text,
        ba.extra_intro,

        ba.report_what,
        ba.report_price,
        ba.report_hours,
        ba.report_location,
        ba.report_reason,

        ba.status,
        ba.reviewer_note_to_applicant,

        ba.submitted_at,
        ba.reviewed_at,
        ba.created_at,
        ba.updated_at,

        ba.published_business_id,

        biz.public_slug
          AS published_business_slug,

        (
          SELECT COUNT(*)::INTEGER
          FROM business_application_files baf
          WHERE
            baf.application_id =
              ba.id
            AND baf.file_kind =
              'proof'
            AND baf.visibility =
              'private'
        ) AS proof_count,

        (
          SELECT COUNT(*)::INTEGER
          FROM business_application_files baf
          WHERE
            baf.application_id =
              ba.id
            AND baf.file_kind =
              'photo'
        ) AS photo_count

      FROM business_applications ba

      LEFT JOIN businesses biz
        ON biz.id =
          ba.published_business_id

      WHERE
        ba.applicant_user_id =
          ${context.userId}

      ORDER BY
        ba.created_at DESC
    `;

  return json({
    ok: true,

    data: {
      count:
        rows.length,

      applications:
        rows,
    },
  });
}


// ==========================================================
// APPLICANT PATCH
// PATCH /api/me/shop-applications/:id
// only needs_more_info / draft
// ==========================================================

export async function handleMyShopApplicationUpdate(
  request,
  env,
  applicationId
) {
  if (
    request.method !== "PATCH"
  ) {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  if (
    !/^\d+$/.test(
      String(applicationId)
    )
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_APPLICATION_ID",
      },
      400
    );
  }

  const context =
    await requireResident(
      request,
      env
    );

  if (context.error) {
    return context.error;
  }

  const existing =
    await context.sql`
      SELECT *
      FROM business_applications

      WHERE id =
        ${applicationId}

        AND applicant_user_id =
          ${context.userId}

      LIMIT 1
    `;

  if (
    existing.length === 0
  ) {
    return json(
      {
        ok: false,
        error:
          "APPLICATION_NOT_FOUND",
      },
      404
    );
  }

  const application =
    existing[0];

  if (
    ![
      "draft",
      "needs_more_info",
    ].includes(
      application.status
    )
  ) {
    return json(
      {
        ok: false,
        error:
          "APPLICATION_NOT_EDITABLE",
      },
      409
    );
  }

  const parsed =
    await parseBody(request);

  if (parsed.error) {
    return parsed.error;
  }

  const body =
    parsed.data;

  if (
    application.application_mode ===
    "owner"
  ) {
    const candidate = {
      shop_name:
        body.shop_name ??
        application.shop_name,

      relation_code:
        body.relation_code ??
        application.relation_code,

      relation_detail:
        body.relation_detail ??
        application.relation_detail,

      category_text:
        body.category_text ??
        application.category_text,

      hours_text:
        body.hours_text ??
        application.hours_text,

      service_price_text:
        body.service_price_text ??
        application.service_price_text,

      location_use_text:
        body.location_use_text ??
        application.location_use_text,

      benefit_text:
        body.benefit_text ??
        application.benefit_text,

      contact_text:
        body.contact_text ??
        application.contact_text,

      extra_intro:
        body.extra_intro ??
        application.extra_intro,
    };

    const error =
      validateOwner(candidate);

    if (error) {
      return json(
        {
          ok: false,
          error,
        },
        400
      );
    }

    const rows =
      await context.sql`
        UPDATE
          business_applications

        SET
          shop_name =
            ${text(
              candidate.shop_name
            )},

          relation_code =
            ${text(
              candidate.relation_code
            )},

          relation_detail =
            ${nullableText(
              candidate.relation_detail
            )},

          category_text =
            ${text(
              candidate.category_text
            )},

          hours_text =
            ${text(
              candidate.hours_text
            )},

          service_price_text =
            ${text(
              candidate.service_price_text
            )},

          location_use_text =
            ${text(
              candidate.location_use_text
            )},

          benefit_text =
            ${nullableText(
              candidate.benefit_text
            )},

          contact_text =
            ${text(
              candidate.contact_text
            )},

          extra_intro =
            ${nullableText(
              candidate.extra_intro
            )},

          updated_at =
            NOW()

        WHERE id =
          ${applicationId}

        RETURNING
          id,
          application_mode,
          shop_name,
          status,
          updated_at
      `;

    return json({
      ok: true,
      data: rows[0],
    });
  }


  const candidate = {
    shop_name:
      body.shop_name ??
      application.shop_name,

    relation_code:
      body.relation_code ??
      application.relation_code,

    relation_detail:
      body.relation_detail ??
      application.relation_detail,

    report_what:
      body.report_what ??
      application.report_what,

    report_price:
      body.report_price ??
      application.report_price,

    report_hours:
      body.report_hours ??
      application.report_hours,

    report_location:
      body.report_location ??
      application.report_location,

    report_reason:
      body.report_reason ??
      application.report_reason,
  };

  const error =
    validateReport(candidate);

  if (error) {
    return json(
      {
        ok: false,
        error,
      },
      400
    );
  }

  const rows =
    await context.sql`
      UPDATE
        business_applications

      SET
        shop_name =
          ${text(
            candidate.shop_name
          )},

        relation_code =
          ${text(
            candidate.relation_code
          )},

        relation_detail =
          ${nullableText(
            candidate.relation_detail
          )},

        report_what =
          ${text(
            candidate.report_what
          )},

        report_price =
          ${nullableText(
            candidate.report_price
          )},

        report_hours =
          ${nullableText(
            candidate.report_hours
          )},

        report_location =
          ${text(
            candidate.report_location
          )},

        report_reason =
          ${text(
            candidate.report_reason
          )},

        updated_at =
          NOW()

      WHERE id =
        ${applicationId}

      RETURNING
        id,
        application_mode,
        shop_name,
        status,
        updated_at
    `;

  return json({
    ok: true,
    data: rows[0],
  });
}


// ==========================================================
// RESUBMIT
// POST /api/me/shop-applications/:id/submit
// ==========================================================

export async function handleMyShopApplicationSubmit(
  request,
  env,
  applicationId
) {
  if (
    request.method !== "POST"
  ) {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const context =
    await requireResident(
      request,
      env
    );

  if (context.error) {
    return context.error;
  }

  const rows =
    await context.sql`
      UPDATE
        business_applications

      SET
        status =
          'submitted',

        submitted_at =
          NOW(),

        reviewer_note_to_applicant =
          NULL,

        updated_at =
          NOW()

      WHERE id =
        ${applicationId}

        AND applicant_user_id =
          ${context.userId}

        AND status IN (
          'draft',
          'needs_more_info'
        )

      RETURNING
        id,
        status,
        submitted_at
    `;

  if (
    rows.length === 0
  ) {
    return json(
      {
        ok: false,
        error:
          "APPLICATION_NOT_SUBMITTABLE",
      },
      409
    );
  }

  await context.sql`
    INSERT INTO
      business_application_events (
        application_id,
        actor_user_id,
        from_status,
        to_status
      )

    VALUES (
      ${applicationId},
      ${context.userId},
      'needs_more_info',
      'submitted'
    )
  `;

  return json({
    ok: true,
    data: rows[0],
  });
}


// ==========================================================
// ADMIN LIST
// GET /api/admin/shop-applications
// ==========================================================

export async function handleAdminShopApplications(
  request,
  env
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  const operator =
    await requireOperator(
      request,
      env
    );

  if (operator.error) {
    return operator.error;
  }

  const url =
    new URL(request.url);

  const status =
    text(
      url.searchParams.get(
        "status"
      )
    );

  const mode =
    text(
      url.searchParams.get(
        "mode"
      )
    );

  const rows =
    await operator.sql`
      SELECT
        ba.*,

        u.display_name
          AS applicant_display_name,

        biz.public_slug
          AS published_business_slug,

        (
          SELECT
            COUNT(*)::INTEGER

          FROM
            business_application_files baf

          WHERE
            baf.application_id =
              ba.id

            AND baf.file_kind =
              'proof'

            AND baf.visibility =
              'private'
        ) AS proof_count,

        (
          SELECT
            COUNT(*)::INTEGER

          FROM
            business_application_files baf

          WHERE
            baf.application_id =
              ba.id

            AND baf.file_kind =
              'photo'
        ) AS photo_count

      FROM
        business_applications ba

      JOIN users u
        ON u.id =
          ba.applicant_user_id

      LEFT JOIN businesses biz
        ON biz.id =
          ba.published_business_id

      WHERE (
        ${status} = ''
        OR ba.status =
          ${status}
      )

      AND (
        ${mode} = ''
        OR ba.application_mode =
          ${mode}
      )

      ORDER BY
        CASE ba.status
          WHEN 'submitted'
            THEN 1
          WHEN 'needs_more_info'
            THEN 2
          ELSE 3
        END,

        ba.created_at DESC
    `;

  return json({
    ok: true,

    data: {
      count:
        rows.length,

      applications:
        rows,
    },
  });
}


// ==========================================================
// ADMIN REVIEW ACTION
//
// POST .../:id/needs-more-info
// POST .../:id/reject
// POST .../:id/approve
// ==========================================================

export async function handleAdminShopApplicationAction(
  request,
  env,
  applicationId,
  action
) {
  if (request.method !== "POST") {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED",
      },
      405
    );
  }

  if (
    !/^\d+$/.test(
      String(applicationId)
    )
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_APPLICATION_ID",
      },
      400
    );
  }

  const operator =
    await requireOperator(
      request,
      env
    );

  if (operator.error) {
    return operator.error;
  }

  const applicationRows =
    await operator.sql`
      SELECT *
      FROM business_applications

      WHERE id =
        ${applicationId}

      LIMIT 1
    `;

  if (
    applicationRows.length === 0
  ) {
    return json(
      {
        ok: false,
        error:
          "APPLICATION_NOT_FOUND",
      },
      404
    );
  }

  const application =
    applicationRows[0];

  if (
    String(
      application.applicant_user_id
    ) ===
    String(operator.userId)
  ) {
    return json(
      {
        ok: false,
        error:
          "SELF_REVIEW_FORBIDDEN",
      },
      403
    );
  }

  const parsed =
    await parseBody(request);

  if (parsed.error) {
    return parsed.error;
  }

  const body =
    parsed.data ?? {};


  // -------------------------------------------------------
  // NEEDS MORE INFO
  // -------------------------------------------------------

  if (
    action ===
    "needs-more-info"
  ) {
    const message =
      text(body.message);

    if (!message) {
      return json(
        {
          ok: false,
          error:
            "MESSAGE_REQUIRED",
        },
        400
      );
    }

    if (
      application.status !==
      "submitted"
    ) {
      return json(
        {
          ok: false,
          error:
            "APPLICATION_NOT_SUBMITTED",
        },
        409
      );
    }

    const rows =
      await operator.sql`
        UPDATE
          business_applications

        SET
          status =
            'needs_more_info',

          reviewer_note_to_applicant =
            ${message},

          reviewer_note_private =
            ${nullableText(
              body.note_private
            )},

          reviewed_by_user_id =
            ${operator.userId},

          reviewed_at =
            NOW(),

          updated_at =
            NOW()

        WHERE id =
          ${applicationId}

        RETURNING
          id,
          status,
          reviewer_note_to_applicant,
          reviewed_at
      `;

    await operator.sql`
      INSERT INTO
        business_application_events (
          application_id,
          actor_user_id,
          from_status,
          to_status,
          note_private
        )

      VALUES (
        ${applicationId},
        ${operator.userId},
        'submitted',
        'needs_more_info',
        ${nullableText(
          body.note_private
        )}
      )
    `;

    return json({
      ok: true,
      data: rows[0],
    });
  }


  // -------------------------------------------------------
  // REJECT
  // -------------------------------------------------------

  if (action === "reject") {
    if (
      ![
        "submitted",
        "needs_more_info",
      ].includes(
        application.status
      )
    ) {
      return json(
        {
          ok: false,
          error:
            "APPLICATION_NOT_REVIEWABLE",
        },
        409
      );
    }

    const message =
      text(body.message);

    if (!message) {
      return json(
        {
          ok: false,
          error:
            "MESSAGE_REQUIRED",
        },
        400
      );
    }

    const rows =
      await operator.sql`
        UPDATE
          business_applications

        SET
          status =
            'rejected',

          reviewer_note_to_applicant =
            ${message},

          reviewer_note_private =
            ${nullableText(
              body.note_private
            )},

          reviewed_by_user_id =
            ${operator.userId},

          reviewed_at =
            NOW(),

          updated_at =
            NOW()

        WHERE id =
          ${applicationId}

        RETURNING
          id,
          status,
          reviewer_note_to_applicant,
          reviewed_at
      `;

    await operator.sql`
      INSERT INTO
        business_application_events (
          application_id,
          actor_user_id,
          from_status,
          to_status,
          note_private
        )

      VALUES (
        ${applicationId},
        ${operator.userId},
        ${application.status},
        'rejected',
        ${nullableText(
          body.note_private
        )}
      )
    `;

    return json({
      ok: true,
      data: rows[0],
    });
  }


  // -------------------------------------------------------
  // APPROVE + PUBLISH
  // -------------------------------------------------------

  if (action === "approve") {
    if (
      application.status !==
      "submitted"
    ) {
      return json(
        {
          ok: false,
          error:
            "APPLICATION_NOT_SUBMITTED",
        },
        409
      );
    }


    // 점주 직접 신청은 실제 private proof가 있어야
    // 공개 승인할 수 있다.
    if (
      application.application_mode ===
      "owner"
    ) {
      const proofRows =
        await operator.sql`
          SELECT
            COUNT(*)::INTEGER
              AS proof_count

          FROM
            business_application_files

          WHERE
            application_id =
              ${applicationId}

            AND file_kind =
              'proof'

            AND visibility =
              'private'
        `;

      if (
        Number(
          proofRows[0]
            ?.proof_count ?? 0
        ) < 1
      ) {
        return json(
          {
            ok: false,
            error:
              "OWNER_PROOF_REQUIRED",
          },
          409
        );
      }
    }


    let relationshipType =
      "local_partner";

    let verifiedResidentUserId =
      null;

    if (
      application.application_mode ===
      "owner"
    ) {
      verifiedResidentUserId =
        application.applicant_user_id;

      if (
        [
          "self",
          "co",
        ].includes(
          application.relation_code
        )
      ) {
        relationshipType =
          "current_resident";
      } else if (
        application.relation_code ===
        "family"
      ) {
        relationshipType =
          "resident_family";
      }
    } else if (
      application.relation_code ===
      "family"
    ) {
      relationshipType =
        "resident_family";

      verifiedResidentUserId =
        application.applicant_user_id;
    }


    const shortIntro =
      application.application_mode ===
      "owner"
        ? (
            application.extra_intro ||
            application.service_price_text
          )
        : application.report_what;


    const description =
      application.application_mode ===
      "owner"
        ? [
            application.service_price_text,
            application.hours_text,
            application.benefit_text,
            application.extra_intro,
          ]
            .filter(Boolean)
            .join("\n\n")
        : [
            application.report_what,
            application.report_reason,
            application.report_price,
            application.report_hours,
          ]
            .filter(Boolean)
            .join("\n\n");


    const serviceArea =
      application.application_mode ===
      "owner"
        ? application.location_use_text
        : application.report_location;


    const published =
      await operator.sql`
        WITH selected_category AS (
          SELECT id

          FROM business_categories

          WHERE slug = 'other'
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
            service_area_text,
            approval_status,
            reviewed_at,
            reviewed_by_user_id
          )

          SELECT
            ${application.shop_name},
            'other',
            sc.id,
            ${nullableText(
              shortIntro
            )},
            ${nullableText(
              description
            )},
            ${nullableText(
              serviceArea
            )},
            'approved',
            NOW(),
            ${operator.userId}

          FROM selected_category sc

          RETURNING
            id,
            public_slug,
            name,
            approval_status
        ),

        owner_link AS (
          INSERT INTO business_owners (
            business_id,
            user_id,
            owner_role
          )

          SELECT
            nb.id,
            ${application.applicant_user_id},
            'owner'

          FROM new_business nb

          WHERE
            ${application.application_mode}
              = 'owner'

          RETURNING
            business_id
        ),

        owner_role AS (
          INSERT INTO user_roles (
            user_id,
            role
          )

          SELECT
            ${application.applicant_user_id},
            'business_owner'

          FROM new_business

          WHERE
            ${application.application_mode}
              = 'owner'

          ON CONFLICT (
            user_id,
            role
          )
          DO NOTHING
        ),

        complex_relation AS (
          INSERT INTO
            business_complex_relationships (
              business_id,
              complex_id,
              relationship_type,
              verified_resident_user_id,
              verification_status,
              verified_at,
              verified_by_user_id,
              verifier_note_private
            )

          SELECT
            nb.id,
            ${application.complex_id},
            ${relationshipType},
            ${verifiedResidentUserId},
            'verified',
            NOW(),
            ${operator.userId},
            ${nullableText(
              body.note_private
            )}

          FROM new_business nb

          RETURNING
            business_id
        ),

        application_update AS (
          UPDATE
            business_applications ba

          SET
            status =
              'published',

            reviewed_by_user_id =
              ${operator.userId},

            reviewed_at =
              NOW(),

            reviewer_note_private =
              ${nullableText(
                body.note_private
              )},

            reviewer_note_to_applicant =
              NULL,

            published_business_id =
              nb.id,

            updated_at =
              NOW()

          FROM new_business nb

          WHERE ba.id =
            ${applicationId}

          RETURNING
            ba.id,
            ba.status,
            ba.published_business_id
        )

        SELECT
          nb.id AS business_id,
          nb.public_slug,
          nb.name,
          nb.approval_status,
          au.status
            AS application_status

        FROM new_business nb

        CROSS JOIN
          application_update au
      `;

    if (
      published.length === 0
    ) {
      return json(
        {
          ok: false,
          error:
            "BUSINESS_PUBLICATION_FAILED",
        },
        500
      );
    }

    await operator.sql`
      INSERT INTO
        business_application_events (
          application_id,
          actor_user_id,
          from_status,
          to_status,
          note_private
        )

      VALUES (
        ${applicationId},
        ${operator.userId},
        'submitted',
        'published',
        ${nullableText(
          body.note_private
        )}
      )
    `;

    return json({
      ok: true,
      data: published[0],
    });
  }


  return json(
    {
      ok: false,
      error:
        "UNKNOWN_REVIEW_ACTION",
    },
    404
  );
}