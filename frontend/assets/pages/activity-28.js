const data={posts:{title:'내가 쓴 글',count:'전체 6개',filters:['전체','가입인사','단지이야기','궁금해요','같이해요'],items:[['단지이야기','2026.08.31','공개','지하주차장 출입구 조명이 어두워요','저녁에 출입구 쪽을 지나는데 한쪽 조명이 꺼져 있었습니다.','공감 3 · 댓글 4'],['가입인사','2026.08.29','공개','안녕하세요, 102동에 사는 연블리입니다.','산책과 동네 맛집 이야기를 좋아해요. 잘 부탁드립니다.','공감 8 · 댓글 12'],['궁금해요','2026.08.28','해결됨','재활용품 배출 시간은 언제인가요?','이번 주 분리배출 시간을 확인하고 싶습니다.','답변 5'],['같이해요','2026.08.26','모임 완료','토요일 저녁 산책 같이해요','단지 정문에서 만나 40분 정도 걸었습니다.','참여 3']]},comments:{title:'댓글·답글',count:'전체 18개',filters:['전체','내 댓글','내 답글','답글 받은 댓글'],items:[['댓글','2026.08.31','원문 공개','새로 오신 이웃님, 반갑습니다.','저도 저녁마다 단지 산책을 자주 해요.','답글 2'],['답글','2026.08.30','원문 공개','좋은 정보 감사합니다.','말씀해 주신 시간에 맞춰 확인해 볼게요.','공감 2'],['댓글','2026.08.28','원문 공개','관리사무소에 확인해 보니 오후 7시까지라고 해요.','재활용품 배출 시간을 묻는 글에 남긴 답변입니다.','도움된 답변']]},likes:{title:'공감한 글',count:'전체 12개',filters:['전체','단지이야기','궁금해요','같이해요'],items:[['단지이야기','2026.08.31','나만 확인','단지 화단에 가을꽃이 피었어요','출근길에 찍은 사진을 이웃과 나눕니다.','공감 14 · 댓글 6'],['궁금해요','2026.08.29','나만 확인','근처에서 자전거 수리할 곳이 있나요?','이웃들이 알려준 수리점 정보가 있습니다.','답변 7'],['같이해요','2026.08.27','나만 확인','주말 아침 가볍게 걷기','보호자와 아이가 함께 참여하는 산책 모임입니다.','참여 5']]},reviews:{title:'가게 후기',count:'전체 3개',filters:['전체','우리 주민 가게','이웃단지 가게'],items:[['우리 주민 가게','2026.08.30','공개','로드힐 꽃작업실','부모님 생신 꽃다발을 정성스럽게 준비해 주셨어요.','도움돼요 6'],['이웃단지 가게','2026.08.27','공개','바른 자동차정비','정비 내용을 이해하기 쉽게 설명해 주셨습니다.','도움돼요 4'],['우리 주민 가게','2026.08.25','공개','오늘의 반찬','간이 세지 않고 포장이 깔끔해서 좋았어요.','도움돼요 8']]}};const rows=document.querySelector('.rows'),empty=document.querySelector('.empty'),toast=document.querySelector('.toast'),searchInput=document.querySelector('.search input');let timer,current='posts';function showToast(text){toast.textContent=text;toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),2100)}function render(key){current=key;const set=data[key];document.querySelector('.list-title').textContent=set.title;document.querySelector('.list-count').textContent=set.count;document.querySelector('.subfilters').innerHTML=set.filters.map((name,index)=>'<button class="subfilter '+(index===0?'active':'')+'">'+name+'</button>').join('');rows.innerHTML=set.items.map((item,index)=>'<article class="activity-row" data-type="'+item[0]+'" data-row-index="'+index+'"><div class="activity-type"><b>'+item[0]+'</b><time>'+item[1]+'</time></div><div class="activity-copy"><small>'+item[2]+'</small><h2><button class="activity-title-open" type="button" data-action="view" data-row-index="'+index+'">'+item[3]+'</button></h2><p>'+item[4]+'</p></div><div class="activity-meta"><div class="numbers">'+item[5]+'</div><div class="row-actions"><button class="primary" data-action="view" data-row-index="'+index+'">보기</button></div></div></article>').join('');searchInput.value='';empty.innerHTML=current==='__special'&&set.title==='저장한 이웃가게'?'아직 저장한 이웃가게가 없습니다.<br/>홈이나 이웃가게에서 ♡ 저장을 눌러보세요.':'아직 남긴 활동이 없습니다.<br/>우리 단지 이웃과 첫 이야기를 나눠보세요.';empty.style.display=set.items.length?'none':'grid';bindRows();bindSubfilters()}function openActivityDetail(index){const set=data[current],item=set&&set.items&&set.items[index];if(!item)return;const modal=document.getElementById('activityDetailModal');document.getElementById('activityDetailKind').textContent=set.title+' · 상세';document.getElementById('activityDetailStatus').textContent=item[0]+' · '+item[1]+' · '+item[2];document.getElementById('activityDetailTitle').textContent=item[3];document.getElementById('activityDetailBody').textContent=item[4];document.getElementById('activityDetailMeta').textContent=item[5];modal.classList.add('open');modal.setAttribute('aria-hidden','false')}function bindRows(){document.querySelectorAll('[data-action="view"]').forEach(button=>button.addEventListener('click',()=>openActivityDetail(Number(button.dataset.rowIndex))))}function applyFilter(name){const normalized=name.replace('내 ','');let visible=0;document.querySelectorAll('.activity-row').forEach(row=>{row.hidden=name!=='전체'&&row.dataset.type!==normalized;if(!row.hidden)visible++});empty.style.display=visible?'none':'grid'}function bindSubfilters(){document.querySelectorAll('.subfilter').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.subfilter').forEach(item=>item.classList.remove('active'));button.classList.add('active');applyFilter(button.textContent)}))}function runSearch(){const query=searchInput.value.trim().toLowerCase();let visible=0;document.querySelectorAll('.activity-row').forEach(row=>{row.hidden=query&&!row.innerText.toLowerCase().includes(query);if(!row.hidden)visible++});document.querySelectorAll('.subfilter').forEach((item,index)=>item.classList.toggle('active',index===0));empty.style.display=visible?'none':'grid';showToast(query?(visible+'개의 활동을 찾았습니다.'):'전체 활동을 보여드립니다.')}document.querySelector('.search button').addEventListener('click',runSearch);searchInput.addEventListener('keydown',event=>{if(event.key==='Enter')runSearch()});document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(item=>item.classList.remove('active'));button.classList.add('active');render(button.dataset.tab)}));document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>showToast(button.dataset.demo)));
const shopMap={food:['식품·반찬','오늘의 반찬','매일 먹는 반찬을 직접 만들고 예약 주문으로 준비하는 이웃입니다.','주민 10%'],learning:['교육','한결수학','중·고등학생에게 문제를 푸는 이유부터 설명하는 수학 과외입니다.','첫 수업 무료'],home:['생활서비스','온케어 홈서비스','생활공간을 분해·세척·점검하는 생활관리 서비스입니다.','출장비 면제'],professional:['전문서비스','바른 세무상담','세금과 사업 절차를 함께 살펴보는 주민 전문 서비스입니다.','첫 상담 무료']};
function savedSet(){let keys=[];try{keys=JSON.parse(localStorage.getItem('danjion:savedShops')||'[]')}catch(e){}return {title:'저장한 이웃가게',count:'저장 '+keys.length+'개',filters:['전체'],items:keys.map(k=>{const d=shopMap[k]||['이웃단지 가게',k,'저장한 이웃가게입니다.',''];return [d[0],'저장됨','내정보에서 관리',d[1],d[2],d[3]||'가게 보기']})}}
const benefitsSet={title:'받은 혜택',count:'사용 가능 1개',filters:['전체','사용 가능','사용 완료'],items:[['사용 가능','2026.09.05','주민혜택','로드힐 꽃작업실 주민 혜택','꽃다발 예약 상담 시 사용할 수 있는 주민 전용 혜택입니다.','사용 전 · 상세 보기']]};
function renderSpecial(kind){const set=kind==='saved'?savedSet():benefitsSet;document.querySelector('.summary').style.display='none';document.querySelector('.tabs').style.display='none';document.querySelector('.page-head h1').textContent=set.title;document.querySelector('.eyebrow').textContent=kind==='saved'?'SAVED NEIGHBORS':'MY BENEFITS';document.querySelector('.page-copy').innerHTML=kind==='saved'?'<b>관심 있게 저장한 이웃가게를 모아봅니다.</b>홈과 이웃가게에서 저장한 가게가 여기에 표시됩니다.':'<b>받은 주민혜택을 한곳에서 확인하세요.</b>사용 전 혜택과 이용 기록을 구분해 관리할 수 있습니다.';document.querySelector('.mobile-title').textContent=set.title;document.querySelector('.route-note').textContent='내정보에서 선택한 항목을 보고 있습니다.';data.__special=set;render('__special');document.querySelector('.activity-list').classList.add('special-list');}
const qp=new URLSearchParams(location.search),view=qp.get('view'),tabIndex=Math.max(0,Math.min(3,parseInt(qp.get('tab')||'0',10)||0));if(view==='saved'||view==='benefits'){renderSpecial(view)}else{const btns=[...document.querySelectorAll('.tab')];btns.forEach((b,i)=>b.classList.toggle('active',i===tabIndex));render(btns[tabIndex]?.dataset.tab||'posts')}

const activityDetailModal=document.getElementById('activityDetailModal');document.getElementById('activityDetailClose')?.addEventListener('click',()=>{activityDetailModal.classList.remove('open');activityDetailModal.setAttribute('aria-hidden','true')});activityDetailModal?.addEventListener('click',e=>{if(e.target===activityDetailModal){activityDetailModal.classList.remove('open');activityDetailModal.setAttribute('aria-hidden','true')}});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activityDetailModal?.classList.contains('open')){activityDetailModal.classList.remove('open');activityDetailModal.setAttribute('aria-hidden','true')}});


(function(){
const SCREEN="activity";
const FILES={"landing": "index3.html", "home": "04_데일리홈.html", "shops": "01_이웃가게_발견_v3.html", "shopDetail": "01_이웃가게_발견_v3.html", "complex": "05_우리단지_첫화면.html", "noticeList": "06_단지온공지_목록.html", "noticeDetail": "07_단지온공지_상세.html", "apartment": "08_아파트소식_목록.html", "chair": "09_회장인사_상세.html", "residentList": "10_주민소식_목록.html", "residentDetail": "11_주민소식_상세.html", "community": "12_이웃대화_첫화면.html", "communityDetail": "13_이웃대화_글상세_댓글.html", "writeHello": "14_가입인사_글쓰기.html", "writeStory": "15_단지이야기_글쓰기.html", "writeQuestion": "16_궁금해요_글쓰기.html", "writeTogether": "17_같이해요_글쓰기.html", "my": "19_내정보_메인.html", "messages": "20_메시지함_목록.html", "messageDetail": "21_메시지_대화상세.html", "profile": "22_주민_공개프로필.html", "warmth": "23_이웃온기.html", "settings": "24_설정.html", "inquiry": "25_1대1문의.html", "apply": "25A_신청제보.html", "household": "26_우리집연결.html", "notifications": "27_알림함.html", "activity": "28_나의활동.html"};
const norm=s=>(s||'').replace(/\s+/g,' ').trim();
function go(f){
  if(!f)return;
  location.href=f;
}
function main(label){go({'홈':FILES.home,'이웃가게':FILES.shops,'우리단지':FILES.complex,'내정보':FILES.my}[label]);}
function routeFrom(v){v=(v||'').split('#')[0]; if(!v)return null;
  const q=v.includes('?')?'?'+v.split('?').slice(1).join('?'):''; const p=v.split('?')[0];
  const arr=[["29_", "index.html"], ["04_", "04_데일리홈.html"], ["01_", "01_이웃가게_발견.html"], ["02_", "02_이웃가게_상세.html"], ["05_", "05_우리단지_첫화면.html"], ["06_", "06_단지온공지_목록.html"], ["07_", "07_단지온공지_상세.html"], ["08_", "08_아파트소식_목록.html"], ["09_", "09_회장인사_상세.html"], ["10_", "10_주민소식_목록.html"], ["11_", "11_주민소식_상세.html"], ["12_", "12_이웃대화_첫화면.html"], ["13_", "13_이웃대화_글상세_댓글.html"], ["14_", "14_가입인사_글쓰기.html"], ["15_", "15_단지이야기_글쓰기.html"], ["16_", "16_궁금해요_글쓰기.html"], ["17_", "17_같이해요_글쓰기.html"], ["19_", "19_내정보_메인.html"], ["20_", "20_메시지함_목록.html"], ["21_", "21_메시지_대화상세.html"], ["22_", "22_주민_공개프로필.html"], ["23_", "23_이웃온기.html"], ["24_", "24_설정.html"], ["25_", "25_1대1문의.html"], ["26_", "26_우리집연결.html"], ["27_", "27_알림함.html"], ["28_", "28_나의활동.html"]];
  for(const [t,f] of arr) if(p.includes(t)) return f+q;
  if(p==='index.html') return 'index.html'; return null;
}
function backFallback(){
  const parentMap={
    shops:FILES.home,shopDetail:FILES.shops,complex:FILES.home,
    noticeList:FILES.complex,noticeDetail:FILES.noticeList,apartment:FILES.complex,chair:FILES.complex,
    residentList:FILES.complex,residentDetail:FILES.residentList,community:FILES.complex,communityDetail:FILES.community,
    writeHello:FILES.community,writeStory:FILES.community,writeQuestion:FILES.community,writeTogether:FILES.community,
    my:FILES.home,messages:FILES.my,messageDetail:FILES.messages,profile:FILES.my,warmth:FILES.my,
    settings:FILES.my,inquiry:FILES.settings,apply:FILES.shops,household:FILES.my,notifications:FILES.my,activity:FILES.my+'?restore=activity'
  };
  location.href=parentMap[SCREEN]||FILES.home;
}

document.addEventListener('click',function(ev){
 const el=ev.target.closest('a,button,[data-route]'); if(!el)return;
 const text=norm(el.textContent), cls=el.classList||{contains:()=>false};
 // landing internal modal/greeting controls stay native
 if(SCREEN==='landing'){
   if(el.matches('[data-auth],[data-preview],[data-greeting],[data-email],[data-social],[data-reset],[data-resend],[data-term],[data-term-close],[data-address-next],[data-terms-next],[data-finish],[data-required-all]')) return;
   if(el.matches('[data-chair-close]')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.home);return;}
   if(el.matches('[data-chair-detail]')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.chair);return;}
   if(el.matches('[data-guest-enter]')){ev.preventDefault();ev.stopImmediatePropagation();sessionStorage.setItem('danjionGuest','1');go(FILES.home);return;}
   if(el.matches('[data-top]')) return;
 }
 if(cls.contains('brand')){ev.preventDefault();ev.stopImmediatePropagation();go('index.html');return;}
 const inMain=!!el.closest('.nav,.desktop-nav,.mobile-bottom,.topbar nav,.main-nav');
 if(inMain && ['홈','이웃가게','우리단지','내정보'].includes(text)){ev.preventDefault();ev.stopImmediatePropagation();if(SCREEN==='activity'&&text==='내정보'){go(FILES.my+'?restore=activity');return;}main(text);return;}
 if(cls.contains('back')||cls.contains('route-back')||((/^←|^‹|^< /.test(text))&&!cls.contains('modal-back'))){ev.preventDefault();ev.stopImmediatePropagation();backFallback();return;}
 // home: current scene -> selected shop detail
 if(SCREEN==='home' && el.id==='detailBtn'){ev.preventDefault();ev.stopImmediatePropagation();const k=el.dataset.shopKey||'food';go(FILES.shopDetail+'?shop='+encodeURIComponent(k));return;}
 // shops cards -> specific shop detail
 if(SCREEN==='shops' && cls.contains('shop-link')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.shopDetail+'?shop='+encodeURIComponent(el.dataset.shopKey||'florist'));return;}
 if(SCREEN==='shops' && text==='이웃가게 제보'){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.apply+'?mode=report');return;}
 if(SCREEN==='shops' && (text==='내 가게 등록 신청'||text==='내 가게 등록 문의')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.apply+'?mode=apply');return;}
 if(SCREEN==='complex' && cls.contains('channel-link')){ev.preventDefault();ev.stopImmediatePropagation();const i=[...document.querySelectorAll('.channel-link')].indexOf(el);go([FILES.noticeList,FILES.apartment,FILES.residentList,FILES.community][i]||FILES.complex);return;}
 if(SCREEN==='noticeList' && (cls.contains('pinned-link')||cls.contains('notice-row'))){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.noticeDetail);return;}
 if(SCREEN==='apartment' && cls.contains('feature-link')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.chair);return;}
 if(SCREEN==='residentList' && cls.contains('story-link')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.residentDetail);return;}
 if(SCREEN==='community' && cls.contains('write-type')){ev.preventDefault();ev.stopImmediatePropagation();const i=[...document.querySelectorAll('.write-type')].indexOf(el);go([FILES.writeHello,FILES.writeStory,FILES.writeQuestion,FILES.writeTogether][i]||FILES.community);return;}
 if(SCREEN==='community' && el.tagName==='A' && text.includes('안녕하세요')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.communityDetail);return;}
 if(SCREEN==='my' && cls.contains('card-link')){ev.preventDefault();ev.stopImmediatePropagation();const i=[...document.querySelectorAll('.card-link')].indexOf(el);go(i===0?FILES.messages:FILES.household);return;}
 if(SCREEN==='my' && cls.contains('menu-row')){ev.preventDefault();ev.stopImmediatePropagation();const i=[...document.querySelectorAll('.menu-row')].indexOf(el);go(FILES.activity+'?tab='+Math.min(i,3));return;}
 if(SCREEN==='my' && (text.includes('설정 열기')||text.includes('이용 설정'))){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.settings);return;}
 if(SCREEN==='messages' && cls.contains('mail-row')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.messageDetail);return;}
 if(SCREEN==='messageDetail' && (text.includes('공개 프로필')||text.includes('산책메이트'))){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.profile);return;}
 if(SCREEN==='profile' && cls.contains('message-button')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.messageDetail);return;}
 if(SCREEN==='settings' && (cls.contains('support-button')||text.includes('1:1 문의'))){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.inquiry);return;}
 if(SCREEN==='activity' && cls.contains('side-link')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.profile);return;}
 // known data-route or anchors
 const dr=el.dataset&&el.dataset.route; if(dr){const f=routeFrom(dr);if(f){ev.preventDefault();ev.stopImmediatePropagation();go(f);return;}}
 if(el.tagName==='A'){const f=routeFrom(el.getAttribute('href'));if(f){ev.preventDefault();ev.stopImmediatePropagation();go(f);return;}}
},true);

// screen-specific initial state
if(SCREEN==='shopDetail'){ const p=new URLSearchParams(location.search),k=p.get('shop'); if(k) setTimeout(()=>window.postMessage({type:'danjion-integrated:setShop',shopKey:k},'*'),0); }
if(SCREEN==='apply'){ const p=new URLSearchParams(location.search),mode=p.get('mode'); if(mode) setTimeout(()=>window.postMessage({type:'danjion-integrated:setMode',mode},'*'),0); }
if(SCREEN==='activity'){ const p=new URLSearchParams(location.search),i=parseInt(p.get('tab')||'0',10); if(Number.isInteger(i)) setTimeout(()=>window.postMessage({type:'danjion-integrated:activityTab',index:i},'*'),0); }
})();


(function(){
  try{
    if(new URLSearchParams(location.search).get('review')==='1'){
      sessionStorage.removeItem('danjionRouteStack');
    }
  }catch(e){}
  function reportRoute(){
    try{
      const file=decodeURIComponent((location.pathname.split('/').pop()||'index.html').split('?')[0]);
      if(window.parent!==window) window.parent.postMessage({type:'danjion-route',file:file,href:location.href},'*');
    }catch(e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reportRoute,{once:true});else reportRoute();
  window.addEventListener('pageshow',reportRoute);
  window.addEventListener('hashchange',reportRoute);
})();

