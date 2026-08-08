import { getPreviewDemoActor, PREVIEW_DEMO_ENABLED } from './preview-demo';

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
    if (PREVIEW_DEMO_ENABLED) {
      const actor = getPreviewDemoActor();
      // The integrated V2 surface currently treats an authenticated `neon` snapshot
      // as a browser-session-ready actor. Preview demo uses that readiness signal only;
      // the request credential remains the explicit non-production dev header below.
      return {
        mode: 'neon',
        subject: actor.subject,
        displayName: actor.displayName,
        authenticated: Boolean(actor.subject)
      };
    }

    const residentSubject = import.meta.env.VITE_DEV_AUTH_USER || 'dev-resident-001';
    const adminSubject = import.meta.env.VITE_DEV_ADMIN_AUTH_USER || 'dev-manager-001';
    const subject = surface === 'admin' ? adminSubject : residentSubject;
    const displayName = surface === 'admin' ? '단지온 운영자' : subject === 'dev-unverified-001' ? '미인증 주민' : '온이웃';
    return { mode: 'dev', subject, displayName, authenticated: Boolean(subject) };
  }

  headers(surface: AuthSurface): HeadersInit {
    const headers: Record<string, string> = {};
    const snapshot = this.snapshot(surface);
    if ((import.meta.env.DEV || PREVIEW_DEMO_ENABLED) && snapshot.subject) {
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
