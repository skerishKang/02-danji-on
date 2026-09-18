import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DANJION_PRODUCTION_DB_URL || '';
const mode = String(process.env.ADMIN_SCOPE_SYNC_MODE || 'preflight').trim();

if (!dbUrl) {
  console.error('ADMIN_SCOPE_SYNC=FAIL missing production database URL');
  process.exit(1);
}
if (!['preflight','apply'].includes(mode)) {
  console.error('ADMIN_SCOPE_SYNC=FAIL invalid mode');
  process.exit(1);
}

const sql = neon(dbUrl);
const legacyOperational = [
  'benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage',
  'resident.verification.exempt','resident_news.review','safety.report.review'
];
const currentOperational = [
  'benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage',
  'resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review'
];

const q = (xs) => xs.map((x) => "'" + x.replaceAll("'","''") + "'").join(',');
const legacySuperSql = "'*'," + q(legacyOperational);
const currentSuperSql = "'*'," + q(currentOperational);
const legacyOpSql = q(legacyOperational);
const currentOpSql = q(currentOperational);

function num(v){ const n=Number(v ?? 0); if(!Number.isFinite(n)) throw new Error('non-numeric'); return n; }

async function readState() {
  const rows = await sql.query(`
    with active as (
      select g.id,g.user_id,g.scope,g.metadata
      from padiem_operator_grants g
      where g.status='active' and (g.expires_at is null or g.expires_at > now())
    ), by_user as (
      select user_id,array_agg(distinct scope order by scope) scopes,count(*)::int grant_rows
      from active group by user_id
    ), classified as (
      select *,
        case
          when cardinality(scopes)=10 and scopes @> array[${currentSuperSql}]::text[] and array[${currentSuperSql}]::text[] @> scopes then 'current_super'
          when cardinality(scopes)=9 and scopes @> array[${legacySuperSql}]::text[] and array[${legacySuperSql}]::text[] @> scopes then 'legacy_super'
          when cardinality(scopes)=9 and array_position(scopes,'*') is null and scopes @> array[${currentOpSql}]::text[] and array[${currentOpSql}]::text[] @> scopes then 'current_operator'
          when cardinality(scopes)=8 and array_position(scopes,'*') is null and scopes @> array[${legacyOpSql}]::text[] and array[${legacyOpSql}]::text[] @> scopes then 'legacy_operator'
          else 'other'
        end kind
      from by_user
    )
    select
      (select count(*)::int from active) active_grant_rows,
      count(*) filter (where kind='current_super')::int current_super_users,
      count(*) filter (where kind='legacy_super')::int legacy_super_users,
      count(*) filter (where kind='current_operator')::int current_operator_users,
      count(*) filter (where kind='legacy_operator')::int legacy_operator_users,
      count(*) filter (where kind='other')::int other_users,
      (select count(*)::int from padiem_admin_identity_allowlist where status='active' and (expires_at is null or expires_at > now())) allowlist_active,
      (select count(*)::int from padiem_admin_identity_allowlist where status='active' and authority_level='admin' and scopes=array['*']::text[]) allowlist_super,
      (select count(*)::int from padiem_admin_identity_allowlist where status='active' and authority_level='operator'
        and cardinality(scopes)=8 and scopes @> array[${legacyOpSql}]::text[] and array[${legacyOpSql}]::text[] @> scopes) allowlist_operator_legacy,
      (select count(*)::int from padiem_admin_identity_allowlist where status='active' and authority_level='operator'
        and cardinality(scopes)=9 and scopes @> array[${currentOpSql}]::text[] and array[${currentOpSql}]::text[] @> scopes) allowlist_operator_current,
      (select count(*)::int from active where metadata ->> 'source'='admin_identity_allowlist' and nullif(metadata ->> 'principalId','') is not null) principal_linked_active_grant_rows,
      (select count(*)::int from active where metadata ->> 'adoptionMarker'='admin-v1-existing-four-626') adoption_marked_active_grant_rows
    from classified
  `,[]);
  return Object.fromEntries(Object.entries(rows[0]||{}).map(([k,v])=>[k,num(v)]));
}

function legacyReady(s){
  return s.active_grant_rows===34
    && s.current_super_users===0 && s.current_operator_users===0
    && s.legacy_super_users===2 && s.legacy_operator_users===2 && s.other_users===0
    && s.allowlist_active===4 && s.allowlist_super===2
    && s.allowlist_operator_legacy===2 && s.allowlist_operator_current===0
    && s.principal_linked_active_grant_rows===34 && s.adoption_marked_active_grant_rows===34;
}

function currentReady(s){
  return s.active_grant_rows===38
    && s.current_super_users===2 && s.current_operator_users===2
    && s.legacy_super_users===0 && s.legacy_operator_users===0 && s.other_users===0
    && s.allowlist_active===4 && s.allowlist_super===2
    && s.allowlist_operator_legacy===0 && s.allowlist_operator_current===2
    && s.principal_linked_active_grant_rows===38 && s.adoption_marked_active_grant_rows===38;
}

async function applySync(){
  const rows=await sql.query(`
    with target_users as materialized (
      select user_id,
        case
          when count(*) filter (where scope='*')=1 then 'admin'
          else 'operator'
        end role
      from padiem_operator_grants
      where status='active' and (expires_at is null or expires_at > now())
        and metadata ->> 'source'='admin_identity_allowlist'
        and metadata ->> 'adoptionMarker'='admin-v1-existing-four-626'
      group by user_id
      having count(*) in (8,9)
    ),
    guard as materialized (
      select 1 ok
      where (select count(*) from target_users)=4
        and (select count(*) from target_users where role='admin')=2
        and (select count(*) from target_users where role='operator')=2
        and not exists (
          select 1 from padiem_operator_grants g
          join target_users t on t.user_id=g.user_id
          where g.status='active' and (g.expires_at is null or g.expires_at > now())
            and g.scope='resident.verification.manage'
        )
    ),
    added as materialized (
      insert into padiem_operator_grants (
        user_id,scope,status,granted_by_user_id,granted_at,expires_at,metadata
      )
      select t.user_id,'resident.verification.manage','active',null,now(),null,
        jsonb_build_object(
          'source','admin_identity_allowlist',
          'principalId',(
            select p.id::text from padiem_admin_identity_allowlist p
            join app_users au on au.auth_user_id = (
              select u.id from danjion_auth."user" u
              join app_users au2 on au2.auth_user_id=u.id
              where au2.id=t.user_id limit 1
            )
            where p.status='active'
              and p.normalized_email=(select lower(btrim(u2.email)) from app_users au3 join danjion_auth."user" u2 on u2.id=au3.auth_user_id where au3.id=t.user_id)
            limit 1
          ),
          'adoptionMarker','admin-v1-existing-four-626',
          'scopeSync','resident-verification-manage-v1'
        )
      from target_users t cross join guard
      returning id,user_id
    ),
    updated_allowlist as materialized (
      update padiem_admin_identity_allowlist p
      set scopes=array[${currentOpSql}]::text[]
      from guard
      where p.status='active' and p.authority_level='operator'
        and cardinality(p.scopes)=8
        and p.scopes @> array[${legacyOpSql}]::text[] and array[${legacyOpSql}]::text[] @> p.scopes
      returning p.id
    ),
    asserted as materialized (
      select 1 / case when
        (select count(*) from added)=4 and
        (select count(*) from updated_allowlist)=2
      then 1 else 0 end ok
    ),
    audited as (
      insert into audit_events(request_id,actor_user_id,actor_kind,complex_id,action,scope,resource_type,resource_id,decision,reason_code,metadata)
      select null,null,'system',null,'admin.scope.sync-current','platform.authz.manage','administrator-principal-set',null,'allowed',
        'ADMIN_CURRENT_SCOPE_SYNCED',jsonb_build_object('principalCount',4,'addedGrantRows',4,'operatorAllowlistRows',2)
      from asserted returning id
    )
    select
      (select count(*)::int from added) added_grant_rows,
      (select count(*)::int from updated_allowlist) updated_allowlist_rows,
      (select count(*)::int from audited) audit_rows
  `,[]);
  return Object.fromEntries(Object.entries(rows[0]||{}).map(([k,v])=>[k,num(v)]));
}

try {
  const before=await readState();
  console.log('ADMIN_SCOPE_SYNC_PREFLIGHT=PASS');
  console.log(JSON.stringify({mode,...before},null,2));
  console.log(`ADMIN_SCOPE_SYNC_READY=${legacyReady(before)?'YES':'NO'}`);
  if(mode==='preflight') process.exit(0);
  if(!legacyReady(before)){ console.error('ADMIN_SCOPE_SYNC=FAIL legacy state mismatch'); process.exit(1); }
  const result=await applySync();
  if(result.added_grant_rows!==4 || result.updated_allowlist_rows!==2 || result.audit_rows!==1){
    console.error('ADMIN_SCOPE_SYNC=FAIL atomic result mismatch'); process.exit(1);
  }
  const after=await readState();
  if(!currentReady(after)){ console.error('ADMIN_SCOPE_SYNC=FAIL post-sync readback mismatch'); process.exit(1); }
  console.log('ADMIN_SCOPE_SYNC=PASS');
  console.log(JSON.stringify({...result,...after},null,2));
} catch(error){
  const code=error && typeof error==='object' && typeof error.code==='string' ? error.code : 'UNKNOWN';
  console.error(`ADMIN_SCOPE_SYNC=FAIL database operation failed sqlstate=${code}`);
  process.exit(1);
}
