import { useState } from 'react';
import { V2CommunityView } from './V2CommunityView';
import './v2-008-complex-hub.css';

export const V2_COMPLEX_HUB_AUTHORITY = {
  driveFileId: '1bBUnFJxOJdEKKZpXLBhv-g9reP_IOxt7',
  title: '05_우리단지_첫화면.html'
} as const;

type ComplexHubChannel = 'official' | 'apartment' | 'resident' | 'dialogue';

const CHANNELS: Array<{
  key: ComplexHubChannel;
  no: string;
  kicker: string;
  title: string;
  description: string;
  action: string;
}> = [
  {
    key: 'official',
    no: '01',
    kicker: '운영 안내',
    title: '단지온공지',
    description: '서비스 이용방법과 운영기준 변경 등 단지온의 공식 안내를 확인합니다.',
    action: '단지온공지 보기'
  },
  {
    key: 'apartment',
    no: '02',
    kicker: '단지 소식',
    title: '아파트소식',
    description: '입주자대표회의 등 공개된 단지 소식과 안내를 확인합니다.',
    action: '아파트소식 보기'
  },
  {
    key: 'resident',
    no: '03',
    kicker: '주민 제보',
    title: '주민소식',
    description: '주민이 알리고 싶은 생활소식·모임·행사와 이웃의 소식을 함께 봅니다.',
    action: '소식 보기 · 제보하기'
  },
  {
    key: 'dialogue',
    no: '04',
    kicker: '주민 대화',
    title: '이웃대화',
    description: '가입인사부터 단지이야기·궁금한 점·같이할 일을 편하게 이야기합니다.',
    action: '이웃대화 들어가기'
  }
];

export function V2ComplexHub({
  verified,
  onVerified,
  onClose
}: {
  verified: boolean;
  onVerified?: () => void;
  onClose: () => void;
}) {
  const [dialogueOpen, setDialogueOpen] = useState(false);

  if (dialogueOpen) {
    return (
      <V2CommunityView
        verified={verified}
        onVerified={onVerified}
        onClose={() => setDialogueOpen(false)}
      />
    );
  }

  function openChannel(channel: ComplexHubChannel) {
    if (channel === 'dialogue') {
      setDialogueOpen(true);
      return;
    }

    if (channel === 'resident') {
      window.dispatchEvent(new CustomEvent('danjion:v2-open-resident-news', { detail: { view: 'feed' } }));
      return;
    }

    window.dispatchEvent(new CustomEvent('danjion:v2-open-complex-news', { detail: { channel } }));
  }

  return (
    <section
      className="v2-complex-hub-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="v2-complex-hub-title"
      data-v2-complex-hub
    >
      <div className="v2-complex-hub-shell">
        <header className="v2-complex-hub-header">
          <div>
            <div className="v2-complex-hub-eyebrow">방림명지로드힐의 네 가지 소식 공간</div>
            <h2 id="v2-complex-hub-title">우리단지</h2>
          </div>
          <div className="v2-complex-hub-intro-copy">
            <strong>단지온 공지는 가장 먼저, 주민의 이야기는 가깝게.</strong>
            <span>운영 공지와 단지의 소식, 주민 대화를 한눈에 확인하세요.</span>
          </div>
          <button className="v2-complex-hub-close" type="button" onClick={onClose} aria-label="우리단지 닫기">×</button>
        </header>

        <div className="v2-complex-hub-channels" aria-label="우리단지 네 가지 소식">
          {CHANNELS.map((channel) => (
            <article
              className={`v2-complex-hub-channel is-${channel.key}`}
              data-v2-complex-channel={channel.key}
              data-no={channel.no}
              key={channel.key}
            >
              <div className="v2-complex-hub-kicker">{channel.kicker}</div>
              <h3>{channel.title}</h3>
              <p>{channel.description}</p>
              <button type="button" className="v2-complex-hub-link" onClick={() => openChannel(channel.key)}>
                <span>{channel.action}</span><span className="v2-complex-hub-arrow" aria-hidden="true">→</span>
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
