import { verifyAuthToken } from "../auth/verify.js";
import { getDb } from "../db/client.js";


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    }
  );
}


async function requireUser(request, env) {
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
      error:
        json(
          {
            ok: false,
            error: "UNAUTHORIZED"
          },
          401
        )
    };
  }

  const sql =
    getDb(env.DATABASE_URL);

  const rows =
    await sql`
      SELECT
        id,
        account_status
      FROM users
      WHERE
        auth_provider = 'neon_auth'
        AND auth_subject =
          ${String(auth.sub)}
        AND account_status = 'active'
      LIMIT 1
    `;

  if (rows.length === 0) {
    return {
      error:
        json(
          {
            ok: false,
            error: "USER_NOT_FOUND"
          },
          403
        )
    };
  }

  return {
    sql,
    user: rows[0]
  };
}


async function requireOwnedApplication(
  request,
  env,
  applicationId
) {
  if (
    !/^\d+$/.test(
      String(applicationId)
    )
  ) {
    return {
      error:
        json(
          {
            ok: false,
            error:
              "INVALID_APPLICATION_ID"
          },
          400
        )
    };
  }

  const required =
    await requireUser(
      request,
      env
    );

  if (required.error) {
    return required;
  }

  const rows =
    await required.sql`
      SELECT
        id,
        applicant_user_id,
        status
      FROM business_applications
      WHERE
        id = ${applicationId}
        AND applicant_user_id =
          ${required.user.id}
      LIMIT 1
    `;

  if (rows.length === 0) {
    return {
      error:
        json(
          {
            ok: false,
            error:
              "SHOP_APPLICATION_NOT_FOUND"
          },
          404
        )
    };
  }

  return {
    ...required,
    application: rows[0]
  };
}


function bucketFor(
  env,
  visibility
) {
  return visibility === "public"
    ? env.PUBLIC_FILES
    : env.PRIVATE_FILES;
}


function visibilityFor(
  fileKind
) {
  return fileKind === "photo"
    ? "public"
    : "private";
}


// ==========================================================
// POST /api/me/shop-applications/:id/files
// multipart/form-data
//
// file_kind:
//   photo
//   proof
//   other_document
//   reference_document
//
// file:
//   actual uploaded File
// ==========================================================

export async function handleShopApplicationFileUpload(
  request,
  env,
  applicationId
) {
  if (request.method !== "POST") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED"
      },
      405
    );
  }

  const owned =
    await requireOwnedApplication(
      request,
      env,
      applicationId
    );

  if (owned.error) {
    return owned.error;
  }

  if (
    owned.application.status === "published" ||
    owned.application.status === "rejected"
  ) {
    return json(
      {
        ok: false,
        error:
          "SHOP_APPLICATION_NOT_EDITABLE"
      },
      409
    );
  }

  let form;

  try {
    form =
      await request.formData();
  } catch {
    return json(
      {
        ok: false,
        error: "INVALID_FORM_DATA"
      },
      400
    );
  }

  const fileKind =
    String(
      form.get("file_kind") ?? ""
    ).trim();

  const allowedKinds =
    new Set([
      "photo",
      "proof",
      "other_document",
      "reference_document"
    ]);

  if (!allowedKinds.has(fileKind)) {
    return json(
      {
        ok: false,
        error: "INVALID_FILE_KIND"
      },
      400
    );
  }

  const file =
    form.get("file");

  if (
    !file ||
    typeof file.arrayBuffer !== "function"
  ) {
    return json(
      {
        ok: false,
        error: "FILE_REQUIRED"
      },
      400
    );
  }


  // ----------------------------------------------
  // PHOTO MAX 3 - SERVER ENFORCED
  // ----------------------------------------------

  if (fileKind === "photo") {

    const countRows =
      await owned.sql`
        SELECT
          COUNT(*)::INTEGER AS count
        FROM business_application_files
        WHERE
          application_id =
            ${applicationId}
          AND file_kind = 'photo'
      `;

    const photoCount =
      Number(
        countRows[0]?.count ?? 0
      );

    if (photoCount >= 3) {
      return json(
        {
          ok: false,
          error: "PHOTO_LIMIT_EXCEEDED",
          max: 3
        },
        409
      );
    }
  }


  const visibility =
    visibilityFor(fileKind);

  const originalName =
    String(
      file.name ?? ""
    ).slice(0, 255) ||
    "upload.bin";

  const mimeType =
    String(
      file.type || ""
    ).slice(0, 127) ||
    "application/octet-stream";

  let bytes;

  try {
    bytes =
      await file.arrayBuffer();
  } catch {
    return json(
      {
        ok: false,
        error: "FILE_READ_FAILED"
      },
      400
    );
  }

  const byteSize =
    bytes.byteLength;

  if (byteSize === 0) {
    return json(
      {
        ok: false,
        error: "FILE_REQUIRED"
      },
      400
    );
  }

  // NOTE: 제품 정책 미정이므로 서버에서
  // 파일 최대 MB 제한을 임의로 강제하지 않는다.
  // 크기만 메타데이터로 기록한다.

  const extension =
    originalName
      .split(".")
      .pop()
      ?.replace(
        /[^a-zA-Z0-9]/g,
        ""
      )
      .slice(0, 10) || "bin";

  const storageKey =
    [
      "shop-applications",
      String(applicationId),
      visibility,
      `${crypto.randomUUID()}.${extension}`
    ].join("/");

  const bucket =
    bucketFor(
      env,
      visibility
    );

  if (!bucket) {
    return json(
      {
        ok: false,
        error:
          "STORAGE_BINDING_NOT_CONFIGURED"
      },
      500
    );
  }


  // ----------------------------------------------
  // ACTUAL STORAGE WRITE
  // ----------------------------------------------

  try {
    await bucket.put(
      storageKey,
      bytes,
      {
        httpMetadata: {
          contentType: mimeType
        }
      }
    );
  } catch {
    return json(
      {
        ok: false,
        error: "STORAGE_WRITE_FAILED"
      },
      500
    );
  }


  try {

    const rows =
      await owned.sql`
        INSERT INTO
          business_application_files (
            application_id,
            file_kind,
            visibility,
            storage_key,
            original_name,
            mime_type,
            byte_size,
            sort_order
          )
        VALUES (
          ${applicationId},
          ${fileKind},
          ${visibility},
          ${storageKey},
          ${originalName},
          ${mimeType},
          ${byteSize},
          100
        )
        RETURNING
          id,
          application_id,
          file_kind,
          visibility,
          original_name,
          mime_type,
          byte_size,
          sort_order,
          created_at
      `;

    const saved =
      rows[0];

    return json(
      {
        ok: true,
        data: {
          ...saved,

          url:
            visibility === "public"
              ? `/api/shop-application-files/${saved.id}`
              : `/api/me/shop-application-files/${saved.id}`
        }
      },
      201
    );

  } catch (error) {

    // DB 실패 시 저장소 orphan 방지
    await bucket.delete(
      storageKey
    );

    throw error;
  }
}


// ==========================================================
// GET /api/me/shop-applications/:id/files
// ==========================================================

export async function handleMyShopApplicationFiles(
  request,
  env,
  applicationId
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED"
      },
      405
    );
  }

  const owned =
    await requireOwnedApplication(
      request,
      env,
      applicationId
    );

  if (owned.error) {
    return owned.error;
  }

  const rows =
    await owned.sql`
      SELECT
        id,
        application_id,
        file_kind,
        visibility,
        original_name,
        mime_type,
        byte_size,
        sort_order,
        created_at
      FROM business_application_files
      WHERE
        application_id =
          ${applicationId}
      ORDER BY
        sort_order,
        id
    `;

  return json({
    ok: true,
    data: {
      files:
        rows.map(
          row => ({
            ...row,

            url:
              row.visibility === "public"
                ? `/api/shop-application-files/${row.id}`
                : `/api/me/shop-application-files/${row.id}`
          })
        )
    }
  });
}


// ==========================================================
// DELETE /api/me/shop-applications/:id/files/:fileId
// ==========================================================

export async function handleShopApplicationFileDelete(
  request,
  env,
  applicationId,
  fileId
) {
  if (request.method !== "DELETE") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED"
      },
      405
    );
  }

  const owned =
    await requireOwnedApplication(
      request,
      env,
      applicationId
    );

  if (owned.error) {
    return owned.error;
  }

  if (
    !/^\d+$/.test(
      String(fileId)
    )
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_FILE_ID"
      },
      400
    );
  }

  if (
    owned.application.status === "published" ||
    owned.application.status === "rejected"
  ) {
    return json(
      {
        ok: false,
        error:
          "SHOP_APPLICATION_NOT_EDITABLE"
      },
      409
    );
  }

  const rows =
    await owned.sql`
      SELECT
        id,
        visibility,
        storage_key
      FROM business_application_files
      WHERE
        id = ${fileId}
        AND application_id =
          ${applicationId}
      LIMIT 1
    `;

  if (rows.length === 0) {
    return json(
      {
        ok: false,
        error: "FILE_NOT_FOUND"
      },
      404
    );
  }

  const target =
    rows[0];

  const bucket =
    bucketFor(
      env,
      target.visibility
    );

  if (!bucket) {
    return json(
      {
        ok: false,
        error:
          "STORAGE_BINDING_NOT_CONFIGURED"
      },
      500
    );
  }

  await bucket.delete(
    target.storage_key
  );

  await owned.sql`
    DELETE FROM
      business_application_files
    WHERE
      id = ${fileId}
      AND application_id =
        ${applicationId}
  `;

  return json({
    ok: true,
    data: {
      deleted_file_id:
        Number(fileId)
    }
  });
}


// ==========================================================
// PUBLIC FILE
// GET /api/shop-application-files/:fileId
//
// PRIVATE rows can NEVER pass this query.
// ==========================================================

export async function handlePublicShopApplicationFile(
  request,
  env,
  fileId
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED"
      },
      405
    );
  }

  if (
    !/^\d+$/.test(
      String(fileId)
    )
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_FILE_ID"
      },
      400
    );
  }

  if (!env.PUBLIC_FILES) {
    return json(
      {
        ok: false,
        error:
          "STORAGE_BINDING_NOT_CONFIGURED"
      },
      500
    );
  }

  const sql =
    getDb(env.DATABASE_URL);

  const rows =
    await sql`
      SELECT
        storage_key
      FROM business_application_files
      WHERE
        id = ${fileId}
        AND visibility = 'public'
      LIMIT 1
    `;

  if (rows.length === 0) {
    return json(
      {
        ok: false,
        error: "PUBLIC_FILE_NOT_FOUND"
      },
      404
    );
  }

  const object =
    await env.PUBLIC_FILES.get(
      rows[0].storage_key
    );

  if (!object) {
    return json(
      {
        ok: false,
        error: "STORED_FILE_NOT_FOUND"
      },
      404
    );
  }

  const headers =
    new Headers();

  object.writeHttpMetadata(headers);

  headers.set(
    "cache-control",
    "public, max-age=3600"
  );

  return new Response(
    object.body,
    {
      headers
    }
  );
}


// ==========================================================
// PRIVATE FILE
// GET /api/me/shop-application-files/:fileId
//
// owner authentication required
// ==========================================================

export async function handlePrivateShopApplicationFile(
  request,
  env,
  fileId
) {
  if (request.method !== "GET") {
    return json(
      {
        ok: false,
        error: "METHOD_NOT_ALLOWED"
      },
      405
    );
  }

  if (
    !/^\d+$/.test(
      String(fileId)
    )
  ) {
    return json(
      {
        ok: false,
        error: "INVALID_FILE_ID"
      },
      400
    );
  }

  if (!env.PRIVATE_FILES) {
    return json(
      {
        ok: false,
        error:
          "STORAGE_BINDING_NOT_CONFIGURED"
      },
      500
    );
  }

  const required =
    await requireUser(
      request,
      env
    );

  if (required.error) {
    return required.error;
  }

  const rows =
    await required.sql`
      SELECT
        baf.storage_key

      FROM
        business_application_files baf

      JOIN
        business_applications ba
        ON ba.id =
          baf.application_id

      WHERE
        baf.id = ${fileId}
        AND baf.visibility = 'private'
        AND ba.applicant_user_id =
          ${required.user.id}

      LIMIT 1
    `;

  if (rows.length === 0) {
    return json(
      {
        ok: false,
        error: "PRIVATE_FILE_NOT_FOUND"
      },
      404
    );
  }

  const object =
    await env.PRIVATE_FILES.get(
      rows[0].storage_key
    );

  if (!object) {
    return json(
      {
        ok: false,
        error: "STORED_FILE_NOT_FOUND"
      },
      404
    );
  }

  const headers =
    new Headers();

  object.writeHttpMetadata(headers);

  headers.set(
    "cache-control",
    "private, no-store"
  );

  return new Response(
    object.body,
    {
      headers
    }
  );
}
