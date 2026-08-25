import { useMemo, useState, type FormEvent } from 'react';
import './v2-community.css';

type CommunityKind = '공식소식' | '주민이야기' | '질문' | '같이해요' | '생활제보' | '우리 단지의 변화' | '함께하는 곳';
type WriteKind = Extract<CommunityKind, '주민이야기' | '질문' | '같이해요' | '생활제보'>;
type Tab = '전체' | CommunityKind;

type Post = {
  id: string;
  type: CommunityKind;
  official?: boolean;
  title: string;
  body: string;
  time: string;
  likes: number;
  comments: number;
  nick?: string;
  pending?: boolean;
};

type Comment = { id: string; nick: string; text: string; pending?: boolean };

const TABS: Tab[] = ['전체', '공식소식', '주민이야기', '질문', '같이해요', '생활제보', '우리 단지의 변화', '함께하는 곳'];

const BASE_POSTS: Post[] = [
  {
    id: 'official-1',
    type: '공식소식',
    official: true,
    title: '주민 생활편의 서비스 단지온을 준비하고 있습니다',
    body: '현재는 제안과 의견수렴 단계입니다. 실제 운영 준비가 확정되면 진행상황을 순서대로 알려드립니다.',
    time: '진행 중',
    likes: 12,
    comments: 1
  },
  {
    id: 'question-1',
    type: '질문',
    title: '에어컨 청소 잘하는 이웃 계실까요?',
    body: '이번 주말 가능한 분을 찾고 있어요. 가까운 이웃의 일이나 이용 경험을 알려주세요.',
    time: '오늘',
    likes: 4,
    comments: 2,
    nick: '방림이웃'
  },
  {
    id: 'together-1',
    type: '같이해요',
    title: '주말 아침 산책 같이하실 분 계세요?',
    body: '무리하지 않고 한 시간 정도 동네를 걷고 싶습니다.',
    time: '오늘',
    likes: 5,
    comments: 1,
    nick: '로드힐이웃'
  },
  {
    id: 'report-1',
    type: '생활제보',
    title: '102동 공동현관 조명이 어두워요',
    body: '저녁 시간에 확인이 필요해 보입니다. 특정 세대를 지목하지 않고 현장 상태만 공유합니다.',
    time: '어제',
    likes: 6,
    comments: 2,
    nick: '단지이웃'
  },
  {
    id: 'change-1',
    type: '우리 단지의 변화',
    official: true,
    title: '주민편의 제안과 준비사항을 순서대로 공유합니다',
    body: '의결·운영 상태를 실제 사실관계와 구분해 안내합니다.',
    time: '안내',
    likes: 9,
    comments: 0
  },
  {
    id: 'partner-1',
    type: '함께하는 곳',
    official: true,
    title: '우리 단지와 연결된 생활 파트너는 관계를 구분해 안내합니다',
    body: '주민 운영, 주민 가족 운영, 주변 제휴, 단지 협력업체를 같은 의미로 표시하지 않습니다.',
    time: '안내',
    likes: 7,
    comments: 0
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
  if (accusation.test(text)) return { action: 'review' as const, reason: '특정인의 범죄·비리 등을 단정하는 내용은 게시 전 권리침해 가능성을 확인합니다.' };
  return { action: 'pass' as const, reason: '' };
}

export function V2CommunityView({ verified, onClose }: { verified: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('전체');
  const [posts, setPosts] = useState<Post[]>(BASE_POSTS);
  const [selected, setSelected] = useState<Post | null>(null);
  const [writeKind, setWriteKind] = useState<WriteKind | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commenting, setCommenting] = useState(false);
  const [notice, setNotice] = useState('');
  const [hasPublishedBefore, setHasPublishedBefore] = useState(false);
  const [reported, setReported] = useState<Set<string>>(() => new Set());

  const visiblePosts = useMemo(() => posts.filter((post) => tab === '전체' || post.type === tab), [posts, tab]);

  function submitPost(event: FormEvent<HTMLFormElement>) {
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
    const pending = checked.action === 'review' || !hasPublishedBefore;
    const post: Post = {
      id: `local-${Date.now()}`,
      type: writeKind,
      title,
      body,
      time: '방금',
      likes: 0,
      comments: 0,
      nick: '방림이웃',
      pending
    };
    setPosts((current) => [post, ...current]);
    setHasPublishedBefore(true);
    setWriteKind(null);
    setTab(writeKind);
    setNotice(pending
      ? checked.reason || '처음 작성한 글은 주민 대화 원칙에 맞는지만 운영팀이 먼저 확인합니다. 내용은 임의로 고치지 않습니다.'
      : '이웃에게 글을 게시했습니다.');
  }

  function submitComment(event: FormEvent<HTMLFormElement>) {
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
    const item: Comment = { id: `comment-${Date.now()}`, nick: '방림이웃', text, pending: checked.action === 'review' };
    setComments((current) => ({ ...current, [selected.id]: [...(current[selected.id] ?? []), item] }));
    setCommenting(false);
    setNotice(item.pending ? '댓글을 운영확인 중입니다.' : '댓글을 게시했습니다.');
  }

  function toggleLike(post: Post) {
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, likes: item.likes + 1 } : item));
    setSelected((current) => current?.id === post.id ? { ...current, likes: current.likes + 1 } : current);
  }

  function reportPost(post: Post) {
    if (reported.has(post.id)) {
      setNotice('이미 신고한 게시물입니다.');
      return;
    }
    setReported((current) => new Set(current).add(post.id));
    setNotice('신고가 접수되었습니다. PADIEM 운영팀이 운영정책에 따라 확인합니다.');
  }

  if (!verified) {
    return (
      <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
        <div className="v2-community-locked">
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="우리단지 닫기">×</button>
          <div className="v2-community-eyebrow">RESIDENT ONLY</div>
          <h2 id="v2-community-title">우리단지는 입주민 확인 후 이용합니다.</h2>
          <p>서비스 로그인과 실제 입주민 확인은 서로 다른 단계입니다. 소셜 로그인만으로 주민 글과 댓글 권한을 부여하지 않습니다.</p>
          <button type="button" className="v2-community-primary" onClick={onClose}>돌아가기</button>
        </div>
      </div>
    );
  }

  const selectedComments = selected ? comments[selected.id] ?? [] : [];

  return (
    <div className="v2-community-layer" role="dialog" aria-modal="true" aria-labelledby="v2-community-title">
      <section className="v2-community-shell">
        <header className="v2-community-header">
          <div>
            <div className="v2-community-eyebrow">NEIGHBOR TALK</div>
            <h2 id="v2-community-title">우리단지</h2>
            <p>공식소식은 분명하게, 주민 이야기는 편안하게 나눕니다.</p>
          </div>
          <button type="button" className="v2-community-close" onClick={onClose} aria-label="우리단지 닫기">×</button>
        </header>

        <nav className="v2-community-tabs" aria-label="우리단지 글 종류">
          {TABS.map((item) => <button key={item} type="button" className={item === tab ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
        </nav>

        {notice && <div className="v2-community-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="안내 닫기">×</button></div>}

        <div className="v2-community-layout">
          <div className="v2-community-posts">
            {visiblePosts.map((post) => (
              <button type="button" key={post.id} className={`v2-community-post ${post.official ? 'is-official' : ''}`} onClick={() => setSelected(post)}>
                <span className="v2-community-post-type">{post.official ? '● ' : ''}{post.type}{post.pending ? ' · 확인 중' : ''}</span>
                <span><strong>{post.title}</strong><small>{post.body}</small></span>
                <span className="v2-community-post-stat">{post.time} · 공감 {post.likes} · 댓글 {post.comments + (comments[post.id]?.filter((item) => !item.pending).length ?? 0)}</span>
              </button>
            ))}
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
            <div className="v2-community-safety">
              <strong>서로를 지키는 주민 대화</strong>
              <p>닉네임만 공개됩니다. 동·호, 연락처, 가입수단은 공개하지 않습니다. 관리사무소에는 회원계정과 게시물 운영정보가 자동 제공되지 않습니다.</p>
            </div>
          </aside>
        </div>
      </section>

      {writeKind && (
        <div className="v2-community-modal-backdrop" role="presentation">
          <form className="v2-community-modal" onSubmit={submitPost}>
            <button type="button" className="v2-community-close" onClick={() => setWriteKind(null)} aria-label="글쓰기 닫기">×</button>
            <div className="v2-community-eyebrow">{writeKind}</div>
            <h3>{writeKind === '질문' ? '궁금한 것을 물어보세요.' : writeKind === '같이해요' ? '같이할 이웃을 찾아보세요.' : writeKind === '생활제보' ? '직접 본 생활 불편을 알려주세요.' : '편하게 주민 이야기를 나눠보세요.'}</h3>
            <label>제목<input name="title" maxLength={80} required /></label>
            <label>내용<textarea name="body" maxLength={1200} required /></label>
            <div className="v2-community-policy-note">사람을 공격하기보다 직접 본 사실, 발생한 시간과 장소, 원하는 해결방법을 중심으로 적어주세요. 개인정보·욕설·위협은 공개되지 않으며 범죄·비리 단정은 운영확인 대상이 될 수 있습니다.</div>
            <button type="submit" className="v2-community-primary">글 등록</button>
          </form>
        </div>
      )}

      {selected && (
        <div className="v2-community-modal-backdrop" role="presentation">
          <article className="v2-community-modal v2-community-detail">
            <button type="button" className="v2-community-close" onClick={() => { setSelected(null); setCommenting(false); }} aria-label="게시물 닫기">×</button>
            <div className="v2-community-detail-meta"><span>{selected.official ? '공식소식' : selected.type}</span><span>{selected.time}</span><span>{selected.official ? '공식 발행' : selected.nick ?? '입주민 확인 주민'}</span></div>
            <h3>{selected.title}</h3>
            <p>{selected.body}</p>
            {!!selectedComments.length && <div className="v2-community-comments">{selectedComments.map((comment) => <div key={comment.id}><small>{comment.nick} · {comment.pending ? '운영확인 중' : '방금'}</small><p>{comment.text}</p></div>)}</div>}
            <div className="v2-community-detail-actions">
              <button type="button" onClick={() => reportPost(selected)}>신고하기</button>
              <button type="button" onClick={() => toggleLike(selected)}>공감하기 · {selected.likes}</button>
              <button type="button" className="v2-community-primary" onClick={() => setCommenting(true)}>댓글 남기기</button>
            </div>
            {commenting && <form className="v2-community-comment-form" onSubmit={submitComment}><label>댓글<textarea name="comment" maxLength={300} required placeholder="사람을 공격하지 않고 내용에 대해 이야기해 주세요." /></label><button type="submit" className="v2-community-primary">댓글 게시</button></form>}
          </article>
        </div>
      )}
    </div>
  );
}
