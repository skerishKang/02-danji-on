import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

/**
 * #844 (CENTRAL review round 3, BLOCKER A): atomic reference acquisition for
 * official apartment-news photo attachments.
 *
 * The delete lane (storage-v1.acquireOfficialNewsImageDeleteIntent) takes a
 * `select ... for update` row lock on business_image_objects and only then moves
 * active -> delete_pending. A plain "validator saw active, later INSERT" write
 * would leave a TOCTOU window, so the post write itself must join the same
 * serialization boundary:
 *
 *   1. preliminary server/Drive validation (storage-reference-v1, outside the tx)
 *   2. this statement: lock the official-news registry row FOR UPDATE
 *   3. re-check kind = official-news-image / state = active / same complex
 *   4. INSERT (or UPDATE) the complex_posts attachment reference from that row
 *   5. commit — the reference and the lock release together
 *
 * If the delete intent won the race, the locked CTE yields no row and the write
 * produces ZERO rows. Callers must treat an empty result as a hard conflict
 * (409) rather than a silent success, which keeps NEW_REFERENCE XOR DELETE_INTENT.
 *
 * #1049: the mutation audit row is part of the very same statement (the audited
 * CTE selects only from the mutated rows), so BUSINESS_MUTATION_COMMIT holds IFF
 * MUTATION_AUDIT_COMMIT: a locked-but-unwritten row audits nothing, and a failed
 * audit insert aborts the whole statement including the post write.
 */

export type OfficialNewsAttachmentAudit = {
  requestId: string;
  scope: string;
  fromStatus: string | null;
};

export type OfficialNewsAttachmentWrite = {
  objectKey: string;
  complexId: string;
  complexSlug: string;
  authorUserId: string;
  sourceName: string;
  category: string;
  title: string;
  body: string;
  channel: string;
  displayMode: 'highlight' | 'article';
  status: string;
  publishedAt: string | null;
  // #1049 mutation-audit context. scope is the operator's actual requestedScope
  // (official-content.manage / council.official-content.manage), so the audit
  // row preserves whichever authority lane passed. Metadata stays bounded to
  // fromStatus/toStatus enums — never post content.
  audit: OfficialNewsAttachmentAudit;
};

export async function insertOfficialNewsPostWithAttachment(
  sql: Sql,
  write: OfficialNewsAttachmentWrite
): Promise<Record<string, unknown>[]> {
  const auditMetadata = JSON.stringify({
    fromStatus: write.audit.fromStatus,
    toStatus: write.status
  });
  const rows = await sql`
    with locked as (
      select object_key
      from business_image_objects
      where object_key = ${write.objectKey}
        and kind = 'official-news-image'
        and state = 'active'
        and complex_id = ${write.complexId}::uuid
      for update
    ),
    mutated as (
      insert into complex_posts (
        complex_id, author_user_id, source_name, category, title, body,
        attachment_object_key, status, published_at, channel, display_mode
      )
      select
        ${write.complexId}::uuid,
        ${write.authorUserId}::uuid,
        ${write.sourceName},
        ${write.category},
        ${write.title},
        ${write.body},
        locked.object_key,
        ${write.status},
        case when ${write.status} = 'published' then coalesce(${write.publishedAt}::timestamptz, now()) else null end,
        ${write.channel},
        ${write.displayMode}
      from locked
      returning id, source_name, category, title, body, status, published_at, created_at, channel, display_mode
    ),
    audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${write.audit.requestId},
        ${write.authorUserId}::uuid,
        'operator',
        ${write.complexId}::uuid,
        'admin.official-content.create',
        ${write.audit.scope},
        'complex_post',
        mutated.id::text,
        'allowed',
        'ADMIN_OFFICIAL_CONTENT_CREATED',
        ${auditMetadata}::jsonb
      from mutated
      returning id
    )
    select mutated.*
    from mutated
    cross join lateral (select count(*) from audited) audit_barrier
  `;
  return rows as Record<string, unknown>[];
}

export async function updateOfficialNewsPostWithAttachment(
  sql: Sql,
  postId: string,
  write: OfficialNewsAttachmentWrite
): Promise<Record<string, unknown>[]> {
  const auditMetadata = JSON.stringify({
    fromStatus: write.audit.fromStatus,
    toStatus: write.status
  });
  const rows = await sql`
    with locked as (
      select object_key
      from business_image_objects
      where object_key = ${write.objectKey}
        and kind = 'official-news-image'
        and state = 'active'
        and complex_id = ${write.complexId}::uuid
      for update
    ),
    mutated as (
      update complex_posts p
      set source_name = ${write.sourceName},
          category = ${write.category},
          title = ${write.title},
          body = ${write.body},
          attachment_object_key = locked.object_key,
          status = ${write.status},
          channel = ${write.channel},
          display_mode = ${write.displayMode},
          published_at = case when ${write.status} = 'published' then coalesce(p.published_at, now()) else p.published_at end
      from locked
      where p.id = ${postId}::uuid
      returning p.id, p.source_name, p.category, p.title, p.body, p.status, p.published_at, p.updated_at, p.channel, p.display_mode
    ),
    audited as (
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope,
        resource_type, resource_id, decision, reason_code, metadata
      )
      select
        ${write.audit.requestId},
        ${write.authorUserId}::uuid,
        'operator',
        ${write.complexId}::uuid,
        'admin.official-content.update',
        ${write.audit.scope},
        'complex_post',
        mutated.id::text,
        'allowed',
        'ADMIN_OFFICIAL_CONTENT_UPDATED',
        ${auditMetadata}::jsonb
      from mutated
      returning id
    )
    select mutated.*
    from mutated
    cross join lateral (select count(*) from audited) audit_barrier
  `;
  return rows as Record<string, unknown>[];
}
