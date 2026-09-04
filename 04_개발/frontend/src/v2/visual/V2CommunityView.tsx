import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  COMMUNITY_API_MODE,
  CommunityApiError,
  communityApi,
  type CommunityComment,
  type CommunityPost,
  type CommunityPostKind,
  type CommunityReply
} from '../../community-api';
import './v2-community.css';

type ConversationKind = '가입인사' | '단지이야기' | '궁금해요' | '같이해요';
type PersistedWriteKind = Exclude<ConversationKind, '가입인사'>;
type Tab = '전체' | ConversationKind;
type AccessState = 'checking' | 'allowed' | 'denied' | 'error';

type Post = {
  id: string;
  source: 'resident';
  type: ConversationKind;
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
type Reply = Comment & { parentCommentId: string };

const TOPICS: Array<{ kind: ConversationKind; no: string; description: string }> = [
  { kind: '가입인사', no: '01', description: '새 이웃과 반갑게 인사해요.' },
  { kind: '단지이야기', no: '02', description: '정보와 일상을 나눠요.' },
  { kind: '궁금해요', no: '03', description: '생활 속 궁금한 것을 물어요.' },
  { kind: '같이해요', no: '04', description: '산책·취미·공동구매를 함께해요.' }
];

const WRITE_KIND_TO_API: Record<PersistedWriteKind, CommunityPostKind> = {
  단지이야기: 'resident_story',
  궁금해요: 'question',
  같이해요: 'together'
};

const API_KIND_TO_UI: Partial<Record<CommunityPostKind, PersistedWriteKind>> = {
  resident_story: '단지이야기',
  question: '궁금해요',
  together: '같이해요'
};

const BASE_POSTS: Post[] = [
  {
    id: 'hello-demo', source: 'resident', type: '가입인사',
    title: '안녕하세요. 오늘 단지온에 처음 가입했어요.',
    body: '이웃분들과 인사하고 단지 소식과 생활정보를 편하게 나누고 싶습니다.',
    time: '오늘', likes: 12, comments: 2, nick: '초록문'
  },
  {
    id: 'story-demo', source: 'resident', type: '단지이야기',
    title: '오늘 분리수거장이 깨끗하게 정리되어 있네요.',
    body: '아침에 내려갔는데 종류별로 가지런히 정리되어 있어서 편하게 이용했습니다.',
    time: '오늘', likes: 8, comments: 1, nick: '길고양이'
  },
  {
    id: 'question-demo', source: 'resident', type: '궁금해요',
    title: '에어컨 청소 잘하는 이웃 계실까요?',
    body: '이번 주말 가능한 분을 찾고 있어요. 이용 경험을 알려주세요.',
    time: '오늘', likes: 4, comments: 2, nick: '방림이웃'
  },
  {
    id: 'together-demo', source: 'resident', type: '같이해요',
    title: '주말 아침 산책 같이하실 분 계세요?',
    body: '무리하지 않고 한 시간 정도 동네를 걷고 싶습니다.',
    time: '어제', likes: 5, comments: 1, nick: '로드힐이웃'
  }
];

function screenCommunityText(title: string, body: string) {
  const text = `${title} ${body}`;
  const threat = /(죽여|패버|때려|가만두지|협박)/i;
  const phone = /(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/;
  const rrn = /\b\d{6}[-\s]?\d{7}\b/;
  const unit = /\b(?:10[12])동\s*\d{3,4}호\b/;
  const accusation = /(횡령|비리|뇌물수수|금품수수|사기꾼|범죄자|도둑)/i;
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

function mapResidentPost(post: CommunityPost): Post | null {
  const type = API_KIND_TO_UI[post.kind];
  if (!type) return null;
  return {
    id: post.id,
    source: 'resident',
    type,
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

function isPost(value: Post | null): value is Post {
  return value !== null;
}

function mapResidentComment(comment: CommunityComment): Comment {
  return {
    id: comment.id,
    nick: comment.author.nickname || '입주민 확인 주민',
    text: comment.body,
    pending: comment.status !== 'published'
  };
}

function mapResidentReply(reply: CommunityReply): Reply {
  return {
    id: reply.id,
    parentCommentId: reply.parentCommentId,
    nick: reply.author.nickname || '입주민 확인 주민',
    text: reply.body,
    pending: reply.status !== 'published'
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
  const [writeKind, setWriteKind] = useState<PersistedWriteKind | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [commenting, setCommenting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
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
        // Screen 12 is resident-only. Official/public complex_posts remain on the
        // resident-news boundary and are intentionally not merged into this feed.
        const residentRows = await communityApi.listPosts();
        if (cancelled) return;
        setPosts(residentRows.map(mapResidentPost).filter(isPost));
        setAccess('allowed');
        onVerified?.();
      } catch (error) {
        if (cancelled) return;
        setAccess(accessError(error) ? 'denied' : 'error');
        if (!accessError(error)) setNotice(error instanceof Error ? error.message : '이웃대화를 불러오지 못했습니다.');
      }
    }

    void loadCommunity();
    return () => { cancelled = true; };
  }, [onVerified, reloadKey]);

  const visiblePosts = useMemo(() => posts.filter((post) => tab === '전체' || post.type === tab), [posts, tab]);
  const selectedComments = selected ? comments[selected.id] ?? [] : [];

  function startWriting(kind: ConversationKind) {
    setTab(kind);
    if (kind === '가입인사') {
      setNotice('가입인사 전용 글쓰기는 서버 카테고리 계약이 추가된 뒤 열립니다. 다른 글 종류로 대신 저장하지 않습니다.');
      return;
    }
    setWriteKind(kind);
  }

  async function openPost(post: Post) {
    setSelected(post);
    setCommenting(false);
    setReplyingTo(null);
    setReplies({});
    if (!COMMUNITY_API_MODE) return;
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

  async function loadReplies(parentCommentId: string) {
    if (!selected || replies[parentCommentId] !== undefined) return;
    if (!COMMUNITY_API_MODE) {
      setReplies((current) => ({ ...current, [parentCommentId]: [] }));
      return;
    }
    setBusy(true);
    try {
      const rows = await communityApi.listReplies(selected.id, parentCommentId);
      setReplies((current) => ({ ...current, [parentCommentId]: rows.map(mapResidentReply) }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '답글을 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function beginReply(parentCommentId: string) {
    await loadReplies(parentCommentId);
    setReplyingTo(parentCommentId);
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
        if (!post) throw new Error('지원하지 않는 이웃대화 글 종류가 반환되었습니다.');
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
    if (!selected) return;
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

  async function submitReply(event: FormEvent<HTMLFormElement>, parentCommentId: string) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const text = String(form.get('reply') ?? '').trim();
    if (!text) return;
    const checked = screenCommunityText('', text);
    if (checked.action === 'block') {
      setNotice(checked.reason);
      return;
    }

    if (COMMUNITY_API_MODE) {
      setBusy(true);
      try {
        const created = await communityApi.createReply(selected.id, parentCommentId, text);
        const item = mapResidentReply(created);
        setReplies((current) => ({ ...current, [parentCommentId]: [...(current[parentCommentId] ?? []), item] }));
        if (!item.pending) {
          setPosts((current) => current.map((post) => post.id === selected.id ? { ...post, comments: post.comments + 1 } : post));
          setSelected((current) => current?.id === selected.id ? { ...current, comments: current.comments + 1 } : current);
        }
        setReplyingTo(null);
        setNotice(item.pending ? '답글이 접수되어 운영확인 중입니다.' : '답글을 게시했습니다.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '답글을 등록하지 못했습니다.');
      } finally {
        setBusy(false);
      }
      return;
    }

    const item: Reply = {
      id: `reply-${Date.now()}`,
      parentCommentId,
      nick: '방림이웃',
      text,
      pending: checked.action === 'review'
    };
    setReplies((current) => ({ ...current, [parentCommentId]: [...(current[parentCommentId] ?? []), item] }));
    setReplyingTo(null);
    setNotice(item.pending ? '답글을 운영확인 중입니다.' : '답글을 게시했습니다.');
  }

  async function toggleLike(post: Post) {
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
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="이웃대화 닫기">×</button>
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
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="이웃대화 닫기">×</button>
          <div className="v2-community-eyebrow">RESIDENT ONLY</div>
          <h2 id="v2-community-title">이웃대화는 입주민 확인 후 이용합니다.</h2>
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
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="이웃대화 닫기">×</button>
          <div className="v2-community-eyebrow">COMMUNITY UNAVAILABLE</div>
          <h2 id="v2-community-title">이웃대화 연결을 확인하지 못했습니다.</h2>
          <p>{notice || '잠시 후 다시 시도해 주세요.'}</p>
          <button type="button" className="v2-community-primary" onClick={() => setReloadKey((value) => value + 1)}>다시 시도</button>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
      <section className="v2-community-shell">
        <div className="v2-community-route">
          <button type="button" onClick={onClose}>← 우리단지</button><span>/ 이웃대화</span>
        </div>

        <header className="v2-community-intro">
          <div>
            <div className="v2-community-eyebrow">우리 단지 주민이 직접 쓰고 대화하는 공간</div>
            <h2 id="v2-community-title">이웃대화</h2>
            <p>카테고리를 고르면 해당 글만 보고, 글쓰기는 바로 그 카테고리로 시작합니다.</p>
          </div>
          <button type="button" className="v2-community-write-main" onClick={() => startWriting('가입인사')}>가입인사 글쓰기 <b>＋</b></button>
          <button type="button" className="v2-community-close v2-community-page-close" onClick={onClose} aria-label="이웃대화 닫기">×</button>
        </header>

        <section className="v2-community-topics" aria-label="이웃대화 유형">
          {TOPICS.map((topic) => (
            <button
              key={topic.kind}
              type="button"
              className={`v2-community-topic ${tab === topic.kind ? 'is-active' : ''}`}
              onClick={() => setTab(topic.kind)}
            >
              <span>{topic.no}</span><b>{topic.kind}</b><small>{topic.description}</small>
            </button>
          ))}
        </section>

        {notice && <div className="v2-community-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="안내 닫기">×</button></div>}

        <section className="v2-community-board">
          <header className="v2-community-board-head">
            <h3>지금 올라온 이야기</h3>
            <button type="button" className={tab === '전체' ? 'is-active' : ''} onClick={() => setTab('전체')}>전체 보기</button>
          </header>
          <div className="v2-community-posts" aria-busy={busy || undefined}>
            {visiblePosts.map((post) => (
              <button type="button" key={post.id} className="v2-community-post" onClick={() => void openPost(post)}>
                <span className="v2-community-post-author"><b>{post.nick || '입주민 확인 주민'}</b><small>{post.pending ? '운영확인 중' : '입주민'}</small></span>
                <span className="v2-community-post-copy">
                  <span className="v2-community-post-type">{post.type}</span>
                  <strong>{post.title}</strong>
                  <small>{post.body}</small>
                </span>
                <span className="v2-community-post-stat">{post.time} · 공감 {post.likes} · 댓글 {post.comments}</span>
              </button>
            ))}
            {!visiblePosts.length && <div className="v2-community-empty"><strong>아직 게시물이 없습니다.</strong><p>이 카테고리에서 이웃과 첫 대화를 시작할 수 있습니다.</p></div>}
          </div>
        </section>

        <button
          type="button"
          className="v2-community-mobile-write"
          aria-label="현재 카테고리 글쓰기"
          onClick={() => startWriting(tab === '전체' ? '가입인사' : tab)}
        >＋</button>
      </section>

      {writeKind && (
        <div className="v2-community-modal-backdrop" role="presentation">
          <form className="v2-community-modal" onSubmit={(event) => void submitPost(event)}>
            <button type="button" className="v2-community-close" onClick={() => setWriteKind(null)} aria-label="글쓰기 닫기">×</button>
            <div className="v2-community-eyebrow">{writeKind}</div>
            <h3>{writeKind === '궁금해요' ? '생활 속 궁금한 것을 물어보세요.' : writeKind === '같이해요' ? '같이할 이웃을 찾아보세요.' : '단지의 정보와 일상을 나눠보세요.'}</h3>
            <label>제목<input name="title" maxLength={160} required placeholder="무엇을 나누고 싶은지 짧게 적어 주세요." /></label>
            <label>내용<textarea name="body" maxLength={10000} required rows={7} placeholder="사람을 특정하거나 개인정보를 적지 않고 상황과 경험 중심으로 이야기해 주세요." /></label>
            <div className="v2-community-policy-note">사진첨부, 질문 하위유형, 같이해요 구조화 필드는 현재 서버 계약에 없어 이 화면에서 별도로 저장하지 않습니다.</div>
            <button type="submit" className="v2-community-primary" disabled={busy}>{busy ? '등록 중…' : '글 등록'}</button>
          </form>
        </div>
      )}

      {selected && (
        <div className="v2-community-modal-backdrop" role="presentation">
          <article className="v2-community-modal v2-community-detail">
            <button type="button" className="v2-community-close" onClick={() => { setSelected(null); setCommenting(false); setReplyingTo(null); setReplies({}); }} aria-label="게시물 닫기">×</button>
            <div className="v2-community-detail-route">← 이웃대화 <span>/ 글 상세</span></div>
            <div className="v2-community-detail-meta"><span>{selected.type}</span><span>{selected.nick ?? '입주민 확인 주민'}</span><span>{selected.time}</span></div>
            <h3>{selected.title}</h3>
            <p>{selected.body}</p>

            <div className="v2-community-detail-actions v2-community-article-actions">
              <button type="button" disabled={busy || selected.pending} aria-pressed={selected.viewerLiked || false} onClick={() => void toggleLike(selected)}>{selected.viewerLiked ? '♥ 공감 취소' : '♡ 공감'} <span>{selected.likes}</span></button>
              <button type="button" disabled={busy || selected.pending} onClick={() => setCommenting(true)}>댓글 <span>{selected.comments}</span></button>
              <button type="button" disabled={busy} onClick={() => void reportPost(selected)}>신고하기</button>
            </div>

            <section className="v2-community-comments" aria-label="댓글">
              <h4>댓글 <span>{selected.comments}</span></h4>
              {selectedComments.map((comment) => {
                const childReplies = replies[comment.id];
                return (
                  <div key={comment.id} data-v2-community-comment>
                    <small>{comment.nick} · {comment.pending ? '운영확인 중' : '게시됨'}</small>
                    <p>{comment.text}</p>
                    {!comment.pending && (
                      <div className="v2-community-detail-actions">
                        {childReplies === undefined && <button type="button" disabled={busy} onClick={() => void loadReplies(comment.id)}>답글 보기</button>}
                        <button type="button" disabled={busy} onClick={() => void beginReply(comment.id)}>답글 남기기</button>
                      </div>
                    )}
                    {childReplies !== undefined && (
                      <div data-v2-community-replies>
                        {childReplies.map((reply) => (
                          <div key={reply.id} data-v2-community-reply>
                            <small>{reply.nick} · 답글 · {reply.pending ? '운영확인 중' : '게시됨'}</small>
                            <p>{reply.text}</p>
                          </div>
                        ))}
                        {!childReplies.length && <small>아직 답글이 없습니다.</small>}
                      </div>
                    )}
                    {replyingTo === comment.id && (
                      <form className="v2-community-comment-form" data-v2-community-reply-form onSubmit={(event) => void submitReply(event, comment.id)}>
                        <label>답글<textarea name="reply" maxLength={300} required placeholder="댓글 내용에 답하면서 개인정보나 공격적 표현은 적지 말아 주세요." /></label>
                        <button type="submit" className="v2-community-primary" disabled={busy}>답글 게시</button>
                        <button type="button" disabled={busy} onClick={() => setReplyingTo(null)}>취소</button>
                      </form>
                    )}
                  </div>
                );
              })}
              {!selectedComments.length && <div className="v2-community-empty"><p>아직 댓글이 없습니다.</p></div>}
            </section>

            {commenting && (
              <form className="v2-community-comment-form v2-community-composer" onSubmit={(event) => void submitComment(event)}>
                <b>댓글 쓰기</b>
                <label>댓글<textarea name="comment" maxLength={300} required placeholder="따뜻한 인사나 도움이 되는 답변을 남겨보세요." /></label>
                <div className="v2-community-composer-foot"><small>서로 존중하는 말로 이야기해 주세요.</small><button type="submit" className="v2-community-primary" disabled={busy}>댓글 등록</button></div>
              </form>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
