import app from './app';
import type { BetterAuthEnv } from './auth-better-v1';
import type { CoreEnv } from './core-v1';
import { runBusinessImageLifecycleReconciliation } from './storage-reconciliation-v1';

type WorkerEnv = CoreEnv & BetterAuthEnv & {
  CORS_ALLOWED_ORIGINS?: string;
  COMMUNITY_PUBLISH_MODE?: string;
  STORAGE_MODE?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?: string;
};

export default {
  fetch: app.fetch,

  async scheduled(
    _controller: ScheduledController,
    env: WorkerEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runBusinessImageLifecycleReconciliation(env).then((summary) => {
        console.log('[DanjiOn BusinessImageReconcile]', JSON.stringify(summary));
      })
    );
  }
};
