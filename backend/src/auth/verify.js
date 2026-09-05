import { createRemoteJWKSet, jwtVerify } from "jose";

let cachedJwks;

function getJwks(authUrl) {
  if (!cachedJwks) {
    const jwksUrl = new URL(
      `${authUrl.replace(/\/$/, "")}/.well-known/jwks.json`
    );

    cachedJwks = createRemoteJWKSet(jwksUrl);
  }

  return cachedJwks;
}

export async function verifyAuthToken(request, env) {
  const authorization = request.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      token,
      getJwks(env.NEON_AUTH_URL)
    );

    if (!payload.sub) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error("Auth token verification failed");
    return null;
  }
}