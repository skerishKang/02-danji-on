export type AuthSurface = 'resident' | 'admin';
export type AuthMode = 'dev' | 'neon';

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

class NeonAuthProvider implements AuthProvider {
  snapshot(): AuthSnapshot {
    return { mode: 'neon', subject: null, displayName: '입주민', authenticated: false };
  }

  headers(): HeadersInit {
    throw new Error('Neon Auth adapter is not configured yet. Use VITE_AUTH_MODE=dev until the sibling-owned Neon project is connected.');
  }
}

export const authProvider: AuthProvider = import.meta.env.VITE_AUTH_MODE === 'neon'
  ? new NeonAuthProvider()
  : new DevAuthProvider();
