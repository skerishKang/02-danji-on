import { useState, type FormEvent } from 'react';
import type { ComplexPost } from '../../types';
import { V2Icon } from './V2Icon';

export function V2Hero({
  complexName = '방림명지로드힐',
  onSearch
}: {
  complexName?: string;
  onSearch?: (query: string) => void;
}) {
  const [query, setQuery] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch?.(query.trim());
  }

  return (
    <section data-v2-section="hero" className="v2-008-home-intro" aria-labelledby="v2-hero-title">
      <div className="v2-008-home-hello">
        <small>WELCOME HOME · {complexName}</small>
        <h1 id="v2-hero-title">필요한 일, 우리 단지에서 먼저 찾습니다.</h1>
        <p>가게 이름보다 먼저 <strong>이웃이 실제로 일하는 장면</strong>을 보여주는 단지온의 첫 화면입니다.</p>
      </div>
      <form className="v2-008-home-search" role="search" onSubmit={submit}>
        <V2Icon name="search" />
        <label className="v2-sr-only" htmlFor="v2-hero-search">이웃가게 검색</label>
        <input
          id="v2-hero-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="반찬 · 과외 · 청소 · 세무"
          autoComplete="off"
        />
        <button type="submit" aria-label="검색"><span aria-hidden="true">→</span></button>
      </form>
    </section>
  );
}

export function V2DailyHomeSummary({
  posts,
  onBrowse,
  onOpenCommunity
}: {
  posts: ComplexPost[];
  onBrowse?: () => void;
  onOpenCommunity?: () => void;
}) {
  return (
    <section data-v2-section="home-summary" className="v2-008-home-summary" aria-label="주민혜택과 우리단지 새 소식">
      <article className="v2-008-home-benefit">
        <div>
          <small>RESIDENT BENEFIT</small>
          <h2>가게마다 다른 주민혜택을<br />이웃가게에서 확인하세요.</h2>
          <p>여러 이웃가게를 둘러본 뒤 각 가게의 혜택 탭에서 자세히 확인할 수 있습니다.</p>
        </div>
        <button type="button" aria-label="이웃가게 전체 보기" onClick={onBrowse}>→</button>
      </article>

      <article className="v2-008-home-news">
        <div className="v2-008-home-news-head">
          <h2>우리단지 새 소식</h2>
          <button type="button" onClick={onOpenCommunity}>전체보기 →</button>
        </div>
        <div className="v2-008-home-news-list">
          {posts.slice(0, 3).map((post) => (
            <div className="v2-008-home-news-row" key={post.id}>
              <small>{post.sourceName || post.category}</small>
              <b>{post.title}</b>
              <span aria-hidden="true">→</span>
            </div>
          ))}
          {posts.length === 0 && <p className="v2-008-home-news-empty">아직 공개된 새 소식이 없습니다.</p>}
        </div>
      </article>
    </section>
  );
}
