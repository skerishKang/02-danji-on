import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { dataAdapter } from '../../api/adapter';
import {
  COMMUNITY_API_MODE,
  CommunityApiError,
  communityApi,
  type CommunityComment,
  type CommunityPost,
  type CommunityPostKind
} from '../../community-api';
import type { ComplexPost } from '../../types';
import './v2-community.css';

type CommunityKind = '공식소식' | '주민이야기' | '질문' | '같이해요' | '생활제보' | '우리 단지의 변화' | '함께하는 곳';
type WriteKind = Extract<CommunityKind, '주민이야기' | '질문' | '같이해요' | '생활제보'>;
type Tab = '전체' | CommunityKind;
type AccessState = 'checking' | 'allowed' | 'denied' | 'error';

type Post = {
  id: string;
  source: 'official' | 'resident';
  type: CommunityKind;
  official?: boolean;
  title: string;
  body: string;
  time: string;
  likes: number;
  comments: number;
  nick?: string;
  pending?: boolean;
  viewerLiked?: boolean;
};

type Comment = { id: string; nick: string; text: string; pending?: boolean };

const TABS: Tab[] = ['전체', '공식소식', '주민이야기', '질문', '같이해요', '생활제보', '우리 단지의 변화', '함께하는 곳'];
const WRITE_KIND_TO_API: Record<WriteKind, CommunityPostKind> = {
  주민이야기: 'resident_story',
  질문: 'question',
  같이해요: 'together',
  생활제보: 'life_report'
};
const API_KIND_TO_UI: Record<CommunityPostKind, WriteKind> = {
  resident_story: '주민이야기',
  question: '질문',
  together: '같이해요',
  life_report: '생활제보'
};

const BASE_POSTS: Post[] = [
  {
    id: 'official-1', source: 'official', type: '공식소식', official: true,
    title: '주민 생활편의 서비스 단지온을 준비하고 있습니다',
    body: '현재는 제안과 의견수렴 단계입니다. 실제 운영 준비가 확정되면 진행상황을 순서대로 알려드립니다.',
    time: '진행 중', likes: 12, comments: 1
  },
  {
    id: 'question-1', source: 'resident', type: '질문',
    title: '에어컨 청소 잘하는 이웃 계실까요?',
    body: '이번 주말 가능한 분을 찾고 있어요. 가까운 이웃의 일이나 이용 경험을 알려주세요.',
    time: '오늘', likes: 4, comments: 2, nick: '방림이웃'
  },
  {
    id: 'together-1', source: 'resident', type: '같이해요',
    title: '주말 아침 산책 같이하실 분 계세요?',
    body: '무리하지 않고 한 시간 정도 동네를 걷고 싶습니다.',
    time: '오늘', likes: 5, comments: 1, nick: '로드힐이웃'
  },
  {
    id: 'report-1', source: 'resident', type: '생활제보',
    title: '102동 공동현관 조명이 어두워요',
    body: '저녁 시간에 확인이 필요해 보입니다. 특정 세대를 지목하지 않고 현장 상태만 공유합니다.',
    time: '어제', likes: 6, comments: 2, nick: '단지이웃'
  },
  {
    id: 'change-1', source: 'official', type: '우리 단지의 변화', official: true,
    title: '주민편의 제안과 준비사항을 순서대로 공유합니다',
    body: '의결·운영 상태를 실제 사실관계와 구분해 안내합니다.',
    time: '안내', likes: 9, comments: 0
  },
  {
    id: 'partner-1', source: 'official', type: '함께하는 곳', official: true,
    title: '우리 단지와 연결된 생활 파트너는 관계를 구분해 안내합니다',
    body: '주민 운영, 주민 가족 운영, 주변 제휴, 단지 협력업체를 같은 의미로 표시하지 않습니다.',
    time: '안내', likes: 7, comments: 0
  }
];

function screenCommunityText(title: string, body: string) {
  const text = `${title} ${body}`;
  const threat = /(죽여|패버|때려|가만두지|협박)/i;
  const phone = /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const rrn = /\b\d{6}[-\s]?\d{7}\b/;
  const unit = /\b(?:10[12])동\s*\d{3,4}호\b/;
  const accusation = /(횡령|비리|뇌물|금품수수|사기꾼|범죄자|도둑)/i;
  const insult = /(미친|병신|개새|씨발|년아|놈아)/i;

  if (phone.test(text) || rrn.test(text) || unit.test(text)) return { action: 'block' as const, reason: '전화번호·특정 세대·주민등록번호 등 주민 개인정보는 공개 글에 적을 수 없습니다.' };
  if (threat.test(text) || insult.test(text)) return { action: 'block' as const, reason: '욕설·모욕·위협 표현은 고쳐 쓴 뒤 등록해 주세요.' };
  if (accusation.test(text)) return { action: 'review' as const, reason: '특정인의 범죄·비리 등을 단정하는 내용은 게시 전 권리침해 가능성을 확인할 수 있습니다.' };
  return { action: 'pass' as const, reason: '' };
}

function displayTime(value: string | null | undefined, fallback = '방금') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function officialKind(post: ComplexPost): CommunityKind {
  const text = `${post.category} ${post.sourceName}`.toLowerCase();
  if (/변화|진행|의결|운영|progress|govern/.test(text)) return '우리 단지의 변화';
  if (/협력|제휴|파트너|partner|business/.test(text)) return '함께하는 곳';
  return '공식소식';
}

function mapOfficialPost(post: ComplexPost): Post {
  return {
    id: `official-${post.id}`,
    source: 'official',
    type: officialKind(post),
    official: true,
    title: post.title,
    body: post.body,
    time: displayTime(post.publishedAt, '공식 안내'),
    likes: 0,
    comments: 0,
    nick: post.sourceName || '단지온 공식'
  };
}

function mapResidentPost(post: CommunityPost): Post {
  return {
    id: post.id,
    source: 'resident',
    type: API_KIND_TO_UI[post.kind],
    title: post.title,
    body: post.body,
    time: displayTime(post.publishedAt || post.createdAt),
    likes: post.reactionCount,
    comments: post.commentCount,
    nick: post.author.nickname || '입주민 확인 주민',
    pending: post.status !== 'published',
    viewerLiked: post.viewerLiked
  };
}

function mapResidentComment(comment: CommunityComment): Comment {
  return {
    id: comment.id,
    nick: comment.author.nickname || '입주민 확인 주민',
    text: comment.body,
    pending: comment.status !== 'published'
  };
}

function accessError(error: unknown) {
  return error instanceof CommunityApiError && (error.status === 401 || error.status === 403);
}

export function V2CommunityView({
  verified,
  onClose,
  onVerified
}: {
  verified: boolean;
  onClose: () => void;
  onVerified?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('전체');
  const [posts, setPosts] = useState<Post[]>(COMMUNITY_API_MODE ? [] : BASE_POSTS);
  const [selected, setSelected] = useState<Post | null>(null);
  const [writeKind, setWriteKind] = useState<WriteKind | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commenting, setCommenting] = useState(false);
  const [notice, setNotice] = useState('');
  const [hasPublishedBefore, setHasPublishedBefore] = useState(false);
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [access, setAccess] = useState<AccessState>(COMMUNITY_API_MODE ? 'checking' : verified ? 'allowed' : 'denied');

  useEffect(() => {
    if (!COMMUNITY_API_MODE) setAccess(verified ? 'allowed' : 'denied');
  }, [verified]);

  useEffect(() => {
    if (!COMMUNITY_API_MODE) return;
    let cancelled = false;

    async function loadCommunity() {
      setAccess('checking');
      setNotice('');
      try {
        // The resident feed is the authoritative Household-v2 verification probe.
        // Official complex_posts stay on the existing public content boundary.
        const residentRows = await communityApi.listPosts();
        const officialRows = await dataAdapter.listPosts().catch(() => []);
        if (cancelled) return;
        setPosts([...officialRows.map(mapOfficialPost), ...residentRows.map(mapResidentPost)]);
        setAccess('allowed');
        onVerified?.();
      } catch (error) {
        if (cancelled) return;
        setAccess(accessError(error) ? 'denied' : 'error');
        if (!accessError(error)) setNotice(error instanceof Error ? error.message : '우리단지 정보를 불러오지 못했습니다.');
      }
    }

    void loadCommunity();
    return () => { cancelled = true; };
  }, [onVerified, reloadKey]);

  const visiblePosts = useMemo(() => posts.filter((post) => tab === '전체' || post.type === tab), [posts, tab]);
  const selectedComments = selected ? comments[selected.id] ?? [] : [];

  async function openPost(post: Post) {
    setSelected(post);
    setCommenting(false);
    if (!COMMUNITY_API_MODE || post.source !== 'resident') return;
    setBusy(true);
    try {
      const rows = await communityApi.listComments(post.id);
      setComments((current) => ({ ...current, [post.id]: rows.map(mapResidentComment) }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '댓글을 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writeKind) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const body = String(form.get('body') ?? '').trim();
    if (!title || !body) {
      setNotice('제목과 내용을 입력해 주세요.');
      return;
    }
    const checked = screenCommunityText(title, body);
    if (checked.action === 'block') {
      setNotice(checked.reason);
      return;
    }

    if (COMMUNITY_API_MODE) {
      setBusy(true);
      try {
        const created = await communityApi.createPost({ kind: WRITE_KIND_TO_API[writeKind], title, body });
        const post = mapResidentPost(created);
        setPosts((current) => [post, ...current]);
        setWriteKind(null);
        setTab(writeKind);
        setNotice(post.pending
          ? checked.reason || '글이 접수되었습니다. 서버 게시정책에 따라 운영확인 중입니다.'
          : '이웃에게 글을 게시했습니다.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '글을 등록하지 못했습니다.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const pending = checked.action === 'review' || !hasPublishedBefore;
    const post: Post = {
      id: `local-${Date.now()}`, source: 'resident', type: writeKind, title, body,
      time: '방금', likes: 0, comments: 0, nick: '방림이웃', pending, viewerLiked: false
    };
    setPosts((current) => [post, ...current]);
    setHasPublishedBefore(true);
    setWriteKind(null);
    setTab(writeKind);
    setNotice(pending ? checked.reason || '처음 작성한 글은 주민 대화 원칙에 맞는지만 운영팀이 먼저 확인합니다.' : '이웃에게 글을 게시했습니다.');
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selected.source !== 'resident') return;
    const form = new FormData(event.currentTarget);
    const text = String(form.get('comment') ?? '').trim();
    if (!text) return;
    const checked = screenCommunityText('', text);
    if (checked.action === 'block') {
      setNotice(checked.reason);
      return;
    }

    if (COMMUNITY_API_MODE) {
      setBusy(true);
      try {
        const created = await communityApi.createComment(selected.id, text);
        const item = mapResidentComment(created);
        setComments((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), item] }));
        if (!item.pending) {
          setPosts((current) => current.map((post) => post.id === selected.id ? { ...post, comments: post.comments + 1 } : post));
          setSelected((current) => current?.id === selected.id ? { ...current, comments: current.comments + 1 } : current);
        }
        setCommenting(false);
        setNotice(item.pending ? '댓글이 접수되어 운영확인 중입니다.' : '댓글을 게시했습니다.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '댓글을 등록하지 못했습니다.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const item: Comment = { id: `comment-${Date.now()}`, nick: '방림이웃', text, pending: checked.action === 'review' };
    setComments((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), item] }));
    setCommenting(false);
    setNotice(item.pending ? '댓글을 운영확인 중입니다.' : '댓글을 게시했습니다.');
  }

  async function toggleLike(post: Post) {
    if (post.source !== 'resident') return;
    const nextLiked = !post.viewerLiked;
    if (COMMUNITY_API_MODE) {
      setBusy(true);
      try {
        await communityApi.setLike(post.id, nextLiked);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '공감 상태를 변경하지 못했습니다.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    const delta = nextLiked ? 1 : -1;
    const update = (item: Post) => item.id === post.id
      ? { ...item, viewerLiked: nextLiked, likes: Math.max(0, item.likes + delta) }
      : item;
    setPosts((current) => current.map(update));
    setSelected((current) => current?.id === post.id ? update(current) : current);
  }

  async function reportPost(post: Post) {
    if (post.source !== 'resident') return;
    if (reported.has(post.id)) {
      setNotice('이미 신고한 게시물입니다.');
      return;
    }
    if (COMMUNITY_API_MODE) {
      setBusy(true);
      try {
        const result = await communityApi.report('post', post.id, 'other', 'Product Shell resident report');
        setReported((current) => new Set(current).add(post.id));
        setNotice(result.status === 'already_reported' ? '이미 신고한 게시물입니다.' : '신고가 접수되었습니다. 운영권한과 감사기록 기준에 따라 확인합니다.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '신고를 접수하지 못했습니다.');
      } finally {
        setBusy(false);
      }
      return;
    }
    setReported((current) => new Set(current).add(post.id));
    setNotice('신고가 접수되었습니다. PADIEM 운영팀이 운영정책에 따라 확인합니다.');
  }

  if (access === 'checking') {
    return (
      <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
        <div className="v2-community-locked">
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="우리단지 닫기">×</button>
          <div className="v2-community-eyebrow">RESIDENT CHECK</div>
          <h2 id="v2-community-title">입주민 이용 권한을 확인하고 있습니다.</h2>
          <p>로그인 계정과 Household-v2 입주민 자격을 서버에서 확인합니다.</p>
        </div>
      </div>
    );
  }

  if (access === 'denied') {
    return (
      <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
        <div className="v2-community-locked">
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="우리단지 닫기">×</button>
          <div className="v2-community-eyebrow">RESIDENT ONLY</div>
          <h2 id="v2-community-title">우리단지는 입주민 확인 후 이용합니다.</h2>
          <p>서비스 로그인과 실제 입주민 확인은 서로 다른 단계입니다. 소셜 로그인이나 과거 관리권한만으로 주민 글과 댓글 권한을 부여하지 않습니다.</p>
          <button type="button" className="v2-community-primary" onClick={onClose}>돌아가기</button>
        </div>
      </div>
    );
  }

  if (access === 'error') {
    return (
      <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
        <div className="v2-community-locked">
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="우리단지 닫기">×</button>
          <div className="v2-community-eyebrow">COMMUNITY UNAVAILABLE</div>
          <h2 id="v2-community-title">우리단지 연결을 확인하지 못했습니다.</h2>
          <p>{notice || '잠시 후 다시 시도해 주세요.'}</p>
          <button type="button" className="v2-community-primary" onClick={() => setReloadKey((value) => value + 1)}>다시 시도</button>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
      <section className="v2-community-shell">
        <header className="v2-community-header">
          <div><div className="v2-community-eyebrow">NEIGHBOR TALK</div><h2 id="v2-community-title">우리단지</h2><p>공식소식은 분명하게, 주민 이야기는 편안하게 나눕니다.</p></div>
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="우리단지 닫기">×</button>
        </header>

        <nav className="v2-community-tabs" aria-label="우리단지 글 종류">
          {TABS.map((item) => <button key={item} type="button" className={item === tab ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
        </nav>

        {notice && <div className="v2-community-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="안내 닫기">×</button></div>}

        <div className="v2-community-layout">
          <div className="v2-community-posts" aria-busy={busy || undefined}>
            {visiblePosts.map((post) => (
              <button type="button" key={post.id} className={`v2-community-post ${post.official ? 'is-official' : ''}`} onClick={() => void openPost(post)}>
                <span className="v2-community-post-type">{post.official ? '● ' : ''}{post.type}{post.pending ? ' · 확인 중' : ''}</span>
                <span><strong>{post.title}</strong><small>{post.body}</small></span>
                <span className="v2-community-post-stat">{post.time} · 공감 {post.likes} · 댓글 {post.comments}</span>
              </button>
            ))}
            {!visiblePosts.length && <div className="v2-community-safety"><strong>아직 게시물이 없습니다.</strong><p>입주민이 안전하게 대화를 시작할 수 있습니다.</p></div>}
          </div>

          <aside className="v2-community-write-panel">
            <div className="v2-community-eyebrow">NEIGHBOR TALK</div>
            <h3>무엇을 나누고 싶으세요?</h3>
            <p>글 종류를 고르면 단지온이 필요한 항목을 하나씩 안내합니다.</p>
            <div className="v2-community-write-kinds">
              <button type="button" onClick={() => setWriteKind('질문')}>? 궁금한 것 물어보기</button>
              <button type="button" onClick={() => setWriteKind('같이해요')}>+ 같이할 이웃 찾기</button>
              <button type="button" onClick={() => setWriteKind('주민이야기')}>○ 편하게 이야기 나누기</button>
              <button type="button" onClick={() => setWriteKind('생활제보')}>! 생활 불편 알리기</button>
            </div>
            <div className="v2-community-safety"><strong>서로를 지키는 주민 대화</strong><p>닉네임만 공개됩니다. 동·호, 연락처, 가입수단은 공개하지 않습니다. 최종 게시·권한 판정은 서버 정책을 따릅니다.</p></div>
          </aside>
        </div>
      </section>

      {writeKind && (
        <div className="v2-community-modal-backdrop" role="presentation">
          <form className="v2-community-modal" onSubmit={(event) => void submitPost(event)}>
            <button type="button" className="v2-community-close" onClick={() => setWriteKind(null)} aria-label="글쓰기 닫기">×</button>
            <div className="v2-community-eyebrow">{writeKind}</div>
            <h3>{writeKind === '질문' ? '궁금한 것을 물어보세요.' : writeKind === '같이해요' ? '같이할 이웃을 찾아보세요.' : writeKind === '생활제보' ? '직접 본 생활 불편을 알려주세요.' : '편하게 주민 이야기를 나눠보세요.'}</h3>
            <label>제목<input name="title" maxLength={160} required placeholder="무엇을 나누고 싶은지 짧게 적어 주세요." /></label>
            <label>내용<textarea name="body" maxLength={10000} required rows={7} placeholder="사람을 특정하거나 개인정보를 적지 않고 상황과 경험 중심으로 이야기해 주세요." /></label>
            <button type="submit" className="v2-community-primary" disabled={busy}>{busy ? '등록 중…' : '글 등록'}</button>
          </form>
        </div>
      )}

      {selected && (
        <div className="v2-community-modal-backdrop" role="presentation">
          <article className="v2-community-modal v2-community-detail">
            <button type="button" className="v2-community-close" onClick={() => { setSelected(null); setCommenting(false); }} aria-label="게시물 닫기">×</button>
            <div className="v2-community-detail-meta"><span>{selected.official ? '공식소식' : selected.type}</span><span>{selected.time}</span><span>{selected.official ? selected.nick || '공식 발행' : selected.nick ?? '입주민 확인 주민'}</span></div>
            <h3>{selected.title}</h3>
            <p>{selected.body}</p>
            {!!selectedComments.length && <div className="v2-community-comments">{selectedComments.map((comment) => <div key={comment.id}><small>{comment.nick} · {comment.pending ? '운영확인 중' : '게시됨'}</small><p>{comment.text}</p></div>)}</div>}
            {selected.source === 'resident' ? (
              <>
                <div className="v2-community-detail-actions">
                  <button type="button" disabled={busy} onClick={() => void reportPost(selected)}>신고하기</button>
                  <button type="button" disabled={busy || selected.pending} aria-pressed={selected.viewerLiked || false} onClick={() => void toggleLike(selected)}>{selected.viewerLiked ? '공감 취소' : '공감하기'} · {selected.likes}</button>
                  <button type="button" className="v2-community-primary" disabled={busy || selected.pending} onClick={() => setCommenting(true)}>댓글 남기기</button>
                </div>
                {commenting && <form className="v2-community-comment-form" onSubmit={(event) => void submitComment(event)}><label>댓글<textarea name="comment" maxLength={300} required placeholder="사람을 공격하지 않고 내용에 대해 이야기해 주세요." /></label><button type="submit" className="v2-community-primary" disabled={busy}>댓글 게시</button></form>}
              </>
            ) : <div className="v2-community-safety"><strong>공식소식</strong><p>공식 단지 콘텐츠는 기존 public 게시물 경계에서 읽기 전용으로 표시합니다.</p></div>}
          </article>
        </div>
      )}
    </div>
  );
}
