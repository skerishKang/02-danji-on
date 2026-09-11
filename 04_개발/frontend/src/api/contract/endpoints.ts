// Canonical DanjiOn product API endpoint registry (#375 F7, additive).
//
// The same /api/v1/* routes are currently carried by up to three surfaces:
// the static sibling-v3 bridges (top-level frontend/assets/*-bridge.js), the
// legacy React V1 clients (src/*-client.ts), and the production React V2
// adapter (src/api/adapter.ts). This module is the single named source of
// truth for the cross-surface endpoint set so literal drift between the
// surfaces is detectable.
//
// Call sites are intentionally NOT rewritten yet (wiring migration happens in
// a later slice). The registry is verified by
// tests/api-endpoint-registry-contract.mjs, which re-checks every consumer
// claim against the actual files.

export type ApiSurface =
  | 'adapter'
  | `v1:${string}`
  | `bridge:${string}`;

export interface ApiEndpointEntry {
  /** Canonical /api/v1 path prefix (consumer files may append segments). */
  path: string;
  /** Union of HTTP methods observed across the listed consumers. */
  methods: string[];
  /**
   * Consumer keys: 'adapter' = src/api/adapter.ts,
   * 'v1:<name>' = src/<name>-client.ts, 'bridge:<name>' =
   * top-level frontend/assets/<name>-bridge.js.
   */
  consumers: ApiSurface[];
  note?: string;
}

export const API_ENDPOINT_REGISTRY: readonly ApiEndpointEntry[] = [
  {
    path: '/api/v1/me/business-applications',
    methods: ['GET', 'POST', 'PATCH'],
    consumers: ['adapter', 'bridge:application-report'],
    note: 'list / create / resubmit owner business applications'
  },
  {
    path: '/api/v1/me/shop-recommendations',
    methods: ['POST', 'PATCH'],
    consumers: ['adapter', 'bridge:application-report'],
    note: 'neighbor shop recommendation intake'
  },
  {
    path: '/api/v1/me/conversations',
    methods: ['GET', 'POST'],
    consumers: ['v1:resident-messages', 'bridge:messages-notifications'],
    note: 'resident message conversations'
  },
  {
    path: '/api/v1/me/notifications',
    methods: ['GET', 'POST'],
    consumers: ['v1:resident-notifications', 'bridge:messages-notifications'],
    note: 'notification feed (POST :id/read per item)'
  },
  {
    path: '/api/v1/me/notifications/read-all',
    methods: ['POST'],
    consumers: ['v1:resident-notifications', 'bridge:messages-notifications']
  },
  {
    path: '/api/v1/household/family-invites/redeem',
    methods: ['POST'],
    consumers: ['v1:household-family', 'bridge:household-claim']
  },
  {
    path: '/api/v1/me/benefits',
    methods: ['GET', 'PATCH'],
    consumers: ['adapter', 'bridge:benefit-claim'],
    note: 'benefit wallet (PATCH :id/use)'
  },
  {
    path: '/api/v1/me/bookmarks',
    methods: ['GET', 'POST', 'DELETE'],
    consumers: ['adapter', 'bridge:saved-shops'],
    note: 'saved shops (POST/DELETE :id)'
  },
  {
    path: '/api/v1/me/profile',
    methods: ['GET', 'PATCH'],
    consumers: ['v1:resident-profile', 'bridge:resident']
  },
  {
    path: '/api/v1/me/settings',
    methods: ['GET', 'PATCH'],
    consumers: ['v1:resident-settings', 'bridge:resident']
  },
  {
    path: '/api/v1/me/activity',
    methods: ['GET'],
    consumers: ['adapter', 'bridge:resident']
  },
  {
    path: '/api/v1/me/summary',
    methods: ['GET'],
    consumers: ['v1:resident-summary', 'bridge:resident']
  },
  {
    path: '/api/v1/me/inquiries',
    methods: ['GET', 'POST', 'PATCH'],
    consumers: ['v1:resident-inquiries', 'bridge:inquiry'],
    note: '1:1 inquiries (PATCH :id owner reply)'
  }
];
