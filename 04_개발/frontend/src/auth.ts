export type AuthSurface = 'resident' | 'admin';
export type AuthMode = 'dev' | 'danjion' | 'neon';

export interface AuthSnapshot {
  mode: AuthMode;
  subject: string | null;
  displayName: string;
  authenticated: boolean;
}

export interface AuthProvider {
  snapshot(surface: AuthSurface): AuthSnapshot;
  headers(surface: AuthSurface): HeadersInit;
}

class DevAuthProvider implements AuthProvider {
  snapshot(surface: AuthSurface): AuthSnapshot {
    const residentSubject = import.meta.env.VITE_DEV_AUTH_USER || 'dev-resident-001';
    const adminSubject = import.meta.env.VITE_DEV_ADMIN_AUTH_USER || 'dev-manager-001';
    const subject = surface === 'admin' ? adminSubject : residentSubject;
    const displayName = surface === 'admin' ? '단지온 운영자' : subject === 'dev-unverified-001' ? '미인증 주민' : '온이웃';
    return { mode: 'dev', subject, displayName, authenticated: Boolean(subject) };
  }

  headers(surface: AuthSurface): HeadersInit {
    const headers: Record<string, string> = {};
    const snapshot = this.snapshot(surface);
    if (import.meta.env.DEV && snapshot.subject) {
      headers['x-danjion-dev-auth-user'] = snapshot.subject;
    }
    return headers;
  }
}

class DanjionAuthProvider implements AuthProvider {
  snapshot(): AuthSnapshot {
    return { mode: 'danjion', subject: null, displayName: '입주민', authenticated: false };
  }

  headers(): HeadersInit {
    throw new Error('Danjion Better Auth requires the async JWT bridge. Do not fall back to dev identity in VITE_AUTH_MODE=danjion.');
  }
}

class LegacyNeonAuthProvider implements AuthProvider {
  snapshot(): AuthSnapshot {
    return { mode: 'neon', subject: null, displayName: '입주민', authenticated: false };
  }

  headers(): HeadersInit {
    throw new Error('Legacy Neon Auth browser adapter is not configured. Use VITE_AUTH_MODE=dev or the Danjion Better Auth bridge.');
  }
}

const authMode = import.meta.env.VITE_AUTH_MODE;

export const authProvider: AuthProvider = authMode === 'danjion'
  ? new DanjionAuthProvider()
  : authMode === 'neon'
    ? new LegacyNeonAuthProvider()
    : new DevAuthProvider();
