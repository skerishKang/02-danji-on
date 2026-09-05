import { getDb } from "../db/client.js";
import { verifyAuthToken } from "../auth/verify.js";
import { json } from "./hello.js";

export async function handleMe(request, env) {
  const auth = await verifyAuthToken(request, env);

  if (!auth) {
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

  if (authUsers.length === 0) {
    return json(
      {
        ok: false,
        error: "AUTH_USER_NOT_FOUND",
      },
      401
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
    RETURNING
      id,
      display_name,
      account_status,
      created_at,
      updated_at
  `;

  return json({
    ok: true,
    data: {
      user: users[0],
      auth: {
        email: authUser.email,
        email_verified: authUser.emailVerified,
      },
    },
  });
}