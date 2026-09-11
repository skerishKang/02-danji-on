const data={posts:{title:'내가 쓴 글',count:'전체 6개',filters:['전체','가입인사','단지이야기','궁금해요','같이해요'],items:[['단지이야기','2026.08.31','공개','지하주차장 출입구 조명이 어두워요','저녁에 출입구 쪽을 지나는데 한쪽 조명이 꺼져 있었습니다.','공감 3 · 댓글 4'],['가입인사','2026.08.29','공개','안녕하세요, 102동에 사는 연블리입니다.','산책과 동네 맛집 이야기를 좋아해요. 잘 부탁드립니다.','공감 8 · 댓글 12'],['궁금해요','2026.08.28','해결됨','재활용품 배출 시간은 언제인가요?','이번 주 분리배출 시간을 확인하고 싶습니다.','답변 5'],['같이해요','2026.08.26','모임 완료','토요일 저녁 산책 같이해요','단지 정문에서 만나 40분 정도 걸었습니다.','참여 3']]},comments:{title:'댓글·답글',count:'전체 18개',filters:['전체','내 댓글','내 답글','답글 받은 댓글'],items:[['댓글','2026.08.31','원문 공개','새로 오신 이웃님, 반갑습니다.','저도 저녁마다 단지 산책을 자주 해요.','답글 2'],['답글','2026.08.30','원문 공개','좋은 정보 감사합니다.','말씀해 주신 시간에 맞춰 확인해 볼게요.','공감 2'],['댓글','2026.08.28','원문 공개','관리사무소에 확인해 보니 오후 7시까지라고 해요.','재활용품 배출 시간을 묻는 글에 남긴 답변입니다.','도움된 답변']]},likes:{title:'공감한 글',count:'전체 12개',filters:['전체','단지이야기','궁금해요','같이해요'],items:[['단지이야기','2026.08.31','나만 확인','단지 화단에 가을꽃이 피었어요','출근길에 찍은 사진을 이웃과 나눕니다.','공감 14 · 댓글 6'],['궁금해요','2026.08.29','나만 확인','근처에서 자전거 수리할 곳이 있나요?','이웃들이 알려준 수리점 정보가 있습니다.','답변 7'],['같이해요','2026.08.27','나만 확인','주말 아침 가볍게 걷기','보호자와 아이가 함께 참여하는 산책 모임입니다.','참여 5']]},reviews:{title:'가게 후기',count:'전체 3개',filters:['전체','우리 주민 가게','이웃단지 가게'],items:[['우리 주민 가게','2026.08.30','공개','로드힐 꽃작업실','부모님 생신 꽃다발을 정성스럽게 준비해 주셨어요.','도움돼요 6'],['이웃단지 가게','2026.08.27','공개','바른 자동차정비','정비 내용을 이해하기 쉽게 설명해 주셨습니다.','도움돼요 4'],['우리 주민 가게','2026.08.25','공개','오늘의 반찬','간이 세지 않고 포장이 깔끔해서 좋았어요.','도움돼요 8']]}};const rows=document.querySelector('.rows'),empty=document.querySelector('.empty'),toast=document.querySelector('.toast'),searchInput=document.querySelector('.search input');let timer,current='posts';function showToast(text){toast.textContent=text;toast.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('show'),2100)}function render(key){current=key;const set=data[key];document.querySelector('.list-title').textContent=set.title;document.querySelector('.list-count').textContent=set.count;document.querySelector('.subfilters').innerHTML=set.filters.map((name,index)=>'<button class="subfilter '+(index===0?'active':'')+'">'+name+'</button>').join('');rows.innerHTML=set.items.map((item,index)=>'<article class="activity-row" data-type="'+item[0]+'" data-row-index="'+index+'"><div class="activity-type"><b>'+item[0]+'</b><time>'+item[1]+'</time></div><div class="activity-copy"><small>'+item[2]+'</small><h2><button class="activity-title-open" type="button" data-action="view" data-row-index="'+index+'">'+item[3]+'</button></h2><p>'+item[4]+'</p></div><div class="activity-meta"><div class="numbers">'+item[5]+'</div><div class="row-actions"><button class="primary" data-action="view" data-row-index="'+index+'">보기</button></div></div></article>').join('');searchInput.value='';empty.innerHTML=current==='__special'&&set.title==='저장한 이웃가게'?'아직 저장한 이웃가게가 없습니다.<br/>홈이나 이웃가게에서 ♡ 저장을 눌러보세요.':'아직 남긴 활동이 없습니다.<br/>우리 단지 이웃과 첫 이야기를 나눠보세요.';empty.style.display=set.items.length?'none':'grid';bindRows();bindSubfilters()}function openActivityDetail(index){const set=data[current],item=set&&set.items&&set.items[index];if(!item)return;const modal=document.getElementById('activityDetailModal');document.getElementById('activityDetailKind').textContent=set.title+' · 상세';document.getElementById('activityDetailStatus').textContent=item[0]+' · '+item[1]+' · '+item[2];document.getElementById('activityDetailTitle').textContent=item[3];document.getElementById('activityDetailBody').textContent=item[4];document.getElementById('activityDetailMeta').textContent=item[5];modal.classList.add('open');modal.setAttribute('aria-hidden','false')}function bindRows(){document.querySelectorAll('[data-action="view"]').forEach(button=>button.addEventListener('click',()=>openActivityDetail(Number(button.dataset.rowIndex))))}function applyFilter(name){const normalized=name.replace('내 ','');let visible=0;document.querySelectorAll('.activity-row').forEach(row=>{row.hidden=name!=='전체'&&row.dataset.type!==normalized;if(!row.hidden)visible++});empty.style.display=visible?'none':'grid'}function bindSubfilters(){document.querySelectorAll('.subfilter').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.subfilter').forEach(item=>item.classList.remove('active'));button.classList.add('active');applyFilter(button.textContent)}))}function runSearch(){const query=searchInput.value.trim().toLowerCase();let visible=0;document.querySelectorAll('.activity-row').forEach(row=>{row.hidden=query&&!row.innerText.toLowerCase().includes(query);if(!row.hidden)visible++});document.querySelectorAll('.subfilter').forEach((item,index)=>item.classList.toggle('active',index===0));empty.style.display=visible?'none':'grid';showToast(query?(visible+'개의 활동을 찾았습니다.'):'전체 활동을 보여드립니다.')}document.querySelector('.search button').addEventListener('click',runSearch);searchInput.addEventListener('keydown',event=>{if(event.key==='Enter')runSearch()});document.querySelectorAll('.tab').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(item=>item.classList.remove('active'));button.classList.add('active');render(button.dataset.tab)}));document.querySelectorAll('[data-demo]').forEach(button=>button.addEventListener('click',()=>showToast(button.dataset.demo)));
const shopMap={food:['식품·반찬','오늘의 반찬','매일 먹는 반찬을 직접 만들고 예약 주문으로 준비하는 이웃입니다.','주민 10%'],learning:['교육','한결수학','중·고등학생에게 문제를 푸는 이유부터 설명하는 수학 과외입니다.','첫 수업 무료'],home:['생활서비스','온케어 홈서비스','생활공간을 분해·세척·점검하는 생활관리 서비스입니다.','출장비 면제'],professional:['전문서비스','바른 세무상담','세금과 사업 절차를 함께 살펴보는 주민 전문 서비스입니다.','첫 상담 무료']};
function savedSet(){let keys=[];try{keys=JSON.parse(localStorage.getItem('danjion:savedShops')||'[]')}catch(e){}return {title:'저장한 이웃가게',count:'저장 '+keys.length+'개',filters:['전체'],items:keys.map(k=>{const d=shopMap[k]||['이웃단지 가게',k,'저장한 이웃가게입니다.',''];return [d[0],'저장됨','내정보에서 관리',d[1],d[2],d[3]||'가게 보기']})}}
const benefitsSet={title:'받은 혜택',count:'사용 가능 1개',filters:['전체','사용 가능','사용 완료'],items:[['사용 가능','2026.09.05','주민혜택','로드힐 꽃작업실 주민 혜택','꽃다발 예약 상담 시 사용할 수 있는 주민 전용 혜택입니다.','사용 전 · 상세 보기']]};
function renderSpecial(kind){const set=kind==='saved'?savedSet():benefitsSet;document.querySelector('.summary').style.display='none';document.querySelector('.tabs').style.display='none';document.querySelector('.page-head h1').textContent=set.title;document.querySelector('.eyebrow').textContent=kind==='saved'?'SAVED NEIGHBORS':'MY BENEFITS';document.querySelector('.page-copy').innerHTML=kind==='saved'?'<b>관심 있게 저장한 이웃가게를 모아봅니다.</b>홈과 이웃가게에서 저장한 가게가 여기에 표시됩니다.':'<b>받은 주민혜택을 한곳에서 확인하세요.</b>사용 전 혜택과 이용 기록을 구분해 관리할 수 있습니다.';document.querySelector('.mobile-title').textContent=set.title;document.querySelector('.route-note').textContent='내정보에서 선택한 항목을 보고 있습니다.';data.__special=set;render('__special');document.querySelector('.activity-list').classList.add('special-list');}
const qp=new URLSearchParams(location.search),view=qp.get('view'),tabIndex=Math.max(0,Math.min(3,parseInt(qp.get('tab')||'0',10)||0));if(view==='saved'||view==='benefits'){renderSpecial(view)}else{const btns=[...document.querySelectorAll('.tab')];btns.forEach((b,i)=>b.classList.toggle('active',i===tabIndex));render(btns[tabIndex]?.dataset.tab||'posts')}

const activityDetailModal=document.getElementById('activityDetailModal');document.getElementById('activityDetailClose')?.addEventListener('click',()=>{activityDetailModal.classList.remove('open');activityDetailModal.setAttribute('aria-hidden','true')});activityDetailModal?.addEventListener('click',e=>{if(e.target===activityDetailModal){activityDetailModal.classList.remove('open');activityDetailModal.setAttribute('aria-hidden','true')}});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activityDetailModal?.classList.contains('open')){activityDetailModal.classList.remove('open');activityDetailModal.setAttribute('aria-hidden','true')}});

(function(){
 const params=new URLSearchParams(location.search),special=params.get('view');
 if(special!=='saved'&&special!=='benefits')return;
 try{sessionStorage.setItem('danjion:shopVariant','v3');localStorage.setItem('danjion:shopVariant','v3')}catch(e){}
 document.body.classList.add('visual-special');
 const rows=document.querySelector('.rows'),listTitle=document.querySelector('.list-title'),listCount=document.querySelector('.list-count'),subfilters=document.querySelector('.subfilters'),search=document.querySelector('.search'),modal=document.getElementById('danjionDetailModal'),coupon=document.getElementById('activityCouponModal');
 const shops={
  florist:{key:'florist',category:'꽃·선물',relation:'우리 주민 가게',name:'로드힐 꽃작업실',image:'assets/home-florist.png',desc:'계절 꽃다발과 작은 선물을 예약 상담으로 준비합니다.',service:'꽃다발 · 작은 선물 · 예약 제작',way:'예약 상담 후 방문 수령',benefit:'꽃다발 예약 상담 시 주민 전용 혜택',value:'예약혜택',code:'DANJION · F052',status:'입주민 관계 확인'},
  food:{key:'food',category:'식품·반찬',relation:'우리 주민 가게',name:'오늘의 반찬',image:'assets/scene-food.webp',desc:'매일 먹는 반찬을 직접 만들고 예약 주문으로 준비하는 이웃입니다.',service:'반찬 · 김치 · 계절 메뉴',way:'메뉴별 가격 · 예약 주문',benefit:'방림명지로드힐 주민 10% 할인',value:'10%',code:'DANJION · F010',status:'입주민 관계 확인'},
  home:{key:'home',category:'생활서비스',relation:'주민 가족 가게',name:'온케어 홈서비스',image:'assets/scene-home-care.webp',desc:'에어컨과 세탁기 안쪽까지 분해하고 세척·점검하는 생활관리 서비스입니다.',service:'에어컨 청소 · 세탁기 청소 · 생활 점검',way:'평일·토요일 예약',benefit:'방림명지로드힐 출장비 면제',value:'면제',code:'DANJION · H001',status:'주민 가족 관계 확인'},
  professional:{key:'professional',category:'전문서비스',relation:'우리 주민 가게',name:'바른 세무상담',image:'assets/scene-professional.webp',desc:'세금과 사업 절차를 함께 살펴보며 필요한 문서를 설명하는 주민 전문 서비스입니다.',service:'세무 · 사업자등록 · 문서상담',way:'첫 상담 30분 기준',benefit:'방림명지로드힐 첫 상담 무료',value:'무료',code:'DANJION · P001',status:'입주민 관계 확인'},
  learning:{key:'learning',category:'교육',relation:'우리 주민 가게',name:'한결수학',image:'assets/scene-learning.webp',desc:'중·고등학생에게 문제를 푸는 이유부터 설명하는 수학 과외입니다.',service:'중·고등학생 수학 과외',way:'예약 상담 · 방문/비대면',benefit:'방림명지로드힐 학생 첫 수업 무료',value:'무료',code:'DANJION · L001',status:'등록 시연용 예시'},
  car:{key:'car',category:'자동차',relation:'이웃단지 가게',name:'우리동네 자동차정비',image:'assets/scene-car.webp',desc:'차량 점검과 소모품 교체를 이해하기 쉽게 설명하는 정비 서비스입니다.',service:'차량 점검 · 오일 · 소모품',way:'월–토 예약/방문',benefit:'주민 공임 할인',value:'공임할인',code:'DANJION · C014',status:'이웃가게 확인'},
  beauty:{key:'beauty',category:'생활서비스',relation:'주민 가족 가게',name:'정다운 헤어',image:'assets/scene-beauty.webp',desc:'커트와 기본 관리를 제공하는 주민 가족 생활 미용 서비스입니다.',service:'커트 · 염색 · 기본 케어',way:'화–일 예약 우선',benefit:'입주민 커트 할인',value:'할인',code:'DANJION · B018',status:'주민 가족 관계 확인'},
  photo:{key:'photo',category:'전문서비스',relation:'우리 주민 가게',name:'사진하는 이웃',image:'assets/scene-photo.webp',desc:'가족사진과 프로필을 자연스럽게 촬영하고 기본 보정을 제공합니다.',service:'가족사진 · 프로필 · 소규모 촬영',way:'주말·평일 저녁 예약',benefit:'입주민 촬영비 할인',value:'촬영할인',code:'DANJION · PH01',status:'입주민 관계 확인'},
  coffee:{key:'coffee',category:'카페·간식',relation:'이웃단지 가게',name:'로드힐 커피',image:'assets/scene-food.webp',desc:'가까운 곳에서 편하게 들를 수 있는 주민 제휴 카페 예시입니다.',service:'커피 · 음료',way:'현장 주문',benefit:'주민 확인 후 음료 1천원 할인',value:'1천원',code:'DANJION · C1000',status:'이웃가게 확인'}
 };
 function readArray(key){try{const a=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(a)?a:[]}catch(e){return[]}}
 const savedKeys=()=>readArray('danjion:savedShops'),benefitKeys=()=>readArray('danjion:savedBenefits');
 function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function relationTone(relation){return /가족/.test(relation)?'family':/이웃/.test(relation)&&!/우리 주민/.test(relation)?'neighbor':'resident'}
 function shopCard(s){return `<article class="visual-shop-card" data-key="${esc(s.key)}"><div class="visual-shop-media"><img src="${esc(s.image)}" alt="${esc(s.name)} 대표 이미지"><span class="visual-shop-badge">${esc(s.category)}</span></div><div class="visual-shop-copy"><div class="visual-shop-kicker" data-relation="${relationTone(s.relation)}">${esc(s.relation)}</div><h2>${esc(s.name)}</h2><p>${esc(s.desc)}</p><div class="visual-shop-meta"><span>${esc(s.way)}</span><span>${esc(s.benefit)}</span></div><div class="visual-shop-actions"><button class="primary" type="button" data-open-shop="${esc(s.key)}">보기</button><button type="button" data-unsave="${esc(s.key)}">저장 취소</button></div></div></article>`}
 function benefitCard(s,demo=false){return `<article class="visual-benefit-card"><div class="visual-shop-media"><img src="${esc(s.image)}" alt="${esc(s.name)} 대표 이미지"><span class="visual-shop-badge">${demo?'시연용 예시':'사용 가능'}</span></div><div class="visual-benefit-body"><div class="visual-shop-kicker" data-relation="${relationTone(s.relation)}">${esc(s.relation)}</div><div><h2>${esc(s.name)} 주민 혜택</h2><div class="benefit-big">${esc(s.benefit)}</div></div><div></div><div class="benefit-codebox"><span>혜택번호</span><strong>${esc(s.code)}</strong></div><div class="visual-benefit-actions"><button class="primary" type="button" data-open-benefit="${esc(s.key)}">혜택 보기</button><button type="button" data-open-shop="${esc(s.key)}">가게도 보기</button></div></div></article>`}
 let benefitFilter='전체';
 function draw(){
  if(special==='saved'){const list=savedKeys().map(k=>shops[k]).filter(Boolean);listTitle.textContent='저장한 이웃가게';listCount.textContent='저장 '+list.length+'개';subfilters.innerHTML='';const __tb=document.querySelector('.toolbar');if(__tb)__tb.style.display='none';if(search)search.style.display='none';rows.innerHTML=list.length?list.map(shopCard).join(''):'<div class="empty" style="display:grid;grid-column:1/-1">아직 저장한 이웃가게가 없습니다.<br>홈이나 이웃가게에서 ♡ 저장을 눌러보세요.</div>'}
  else{let keys=benefitKeys(),demo=false;if(!keys.length){keys=['florist'];demo=true}const list=keys.map(k=>shops[k]).filter(Boolean);listTitle.textContent='받은 혜택';if(search)search.style.display='none';subfilters.innerHTML=['전체','사용 가능','사용 완료'].map(label=>`<button class="subfilter${benefitFilter===label?' active':''}" type="button" data-benefit-filter="${label}">${label}</button>`).join('');if(benefitFilter==='사용 완료'){listCount.textContent='사용 완료 0개';rows.innerHTML='<div class="empty" style="display:grid;grid-column:1/-1">아직 사용 완료된 혜택이 없습니다.</div>'}else{listCount.textContent=(demo?'시연용 ':'사용 가능 ')+list.length+'개';rows.innerHTML=list.map(s=>benefitCard(s,demo)).join('')}}
 }
 function openShop(item){if(!item)return;document.getElementById('danjionModalKind').textContent='이웃가게 상세';document.getElementById('danjionModalImage').src=item.image;const modalKicker=document.getElementById('danjionModalKicker');modalKicker.textContent=item.relation;modalKicker.dataset.relation=relationTone(item.relation);document.getElementById('danjionModalTitle').textContent=item.name;document.getElementById('danjionModalDesc').textContent=item.desc;document.getElementById('danjionModalFacts').innerHTML=`<div class="modal-fact"><b>하는 일</b><span>${esc(item.service)}</span></div><div class="modal-fact"><b>이용 방법</b><span>${esc(item.way)}</span></div><div class="modal-fact"><b>상태</b><span>${esc(item.status)}</span></div>`;document.getElementById('danjionModalBenefit').textContent=item.benefit;document.getElementById('danjionModalBenefitAction').textContent='쿠폰/혜택 보기';const modalSave=document.getElementById('danjionModalSave'),isSaved=savedKeys().includes(item.key);modalSave.textContent=isSaved?'♥ 저장됨':'♡ 저장';modalSave.classList.toggle('saved-state',isSaved);document.getElementById('danjionModalShop').textContent='이웃가게 목록에서 보기';document.getElementById('danjionModalShop').onclick=()=>location.href='01_이웃가게_발견_v3.html?shop='+encodeURIComponent(item.key);document.getElementById('danjionModalBenefitAction').onclick=()=>openCoupon(item);document.getElementById('danjionModalSave').onclick=()=>{let a=savedKeys();a=a.includes(item.key)?a.filter(x=>x!==item.key):[...a,item.key];localStorage.setItem('danjion:savedShops',JSON.stringify(a));showToast(a.includes(item.key)?'저장한 이웃가게에 담았습니다.':'저장을 취소했습니다.');draw();openShop(item)};modal.classList.add('open');modal.setAttribute('aria-hidden','false')}
 function closeShop(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}
 function openCoupon(item){document.getElementById('activityCouponShop').textContent=item.name+' · '+item.relation;document.getElementById('activityCouponTitle').textContent=item.benefit;document.getElementById('activityCouponValue').textContent=item.value;document.getElementById('activityCouponCode').textContent=item.code;document.getElementById('activityCouponNote').textContent='예약·문의 또는 방문 시 방림명지로드힐 주민임을 확인한 뒤 적용합니다. 실제 제공 조건은 가게 안내를 우선합니다.';coupon.classList.add('open');coupon.setAttribute('aria-hidden','false')}
 function closeCoupon(){coupon.classList.remove('open');coupon.setAttribute('aria-hidden','true')}
 rows.addEventListener('click',e=>{const o=e.target.closest('[data-open-shop]');if(o){e.preventDefault();e.stopPropagation();openShop(shops[o.dataset.openShop]);return}const b=e.target.closest('[data-open-benefit]');if(b){e.preventDefault();e.stopPropagation();openCoupon(shops[b.dataset.openBenefit]);return}const u=e.target.closest('[data-unsave]');if(u){e.preventDefault();e.stopPropagation();const a=savedKeys().filter(k=>k!==u.dataset.unsave);localStorage.setItem('danjion:savedShops',JSON.stringify(a));showToast('저장을 취소했습니다.');draw()}});
 if(special==='benefits')subfilters.addEventListener('click',e=>{const btn=e.target.closest('[data-benefit-filter]');if(!btn)return;benefitFilter=btn.dataset.benefitFilter||'전체';draw()});
 modal.querySelector('.danjion-modal-close').onclick=closeShop;modal.addEventListener('click',e=>{if(e.target===modal)closeShop()});document.getElementById('activityCouponClose').onclick=closeCoupon;coupon.addEventListener('click',e=>{if(e.target===coupon)closeCoupon()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(coupon.classList.contains('open'))closeCoupon();else if(modal.classList.contains('open'))closeShop()}});draw();
})();

(function(){
const SCREEN="activity";
const FILES={"landing": "index.html", "home": "04_데일리홈.html", "shops": "01_이웃가게_발견_v3.html", "shopDetail": "01_이웃가게_발견_v3.html", "complex": "05_우리단지_첫화면.html", "noticeList": "06_단지온공지_목록.html", "noticeDetail": "07_단지온공지_상세.html", "apartment": "08_아파트소식_목록.html", "chair": "09_회장인사_상세.html", "residentList": "10_주민소식_목록.html", "residentDetail": "11_주민소식_상세.html", "community": "12_이웃대화_첫화면.html", "communityDetail": "13_이웃대화_글상세_댓글.html", "writeHello": "14_가입인사_글쓰기.html", "writeStory": "15_단지이야기_글쓰기.html", "writeQuestion": "16_궁금해요_글쓰기.html", "writeTogether": "17_같이해요_글쓰기.html", "my": "19_내정보_메인.html", "messages": "20_메시지함_목록.html", "messageDetail": "21_메시지_대화상세.html", "profile": "22_주민_공개프로필.html", "warmth": "23_이웃온기.html", "settings": "24_설정.html", "inquiry": "25_1대1문의.html", "apply": "25A_신청제보.html", "household": "26_우리집연결.html", "notifications": "27_알림함.html", "activity": "28_나의활동.html"};
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

(function(){
  var RB=globalThis.DanjionResidentBridge;
  if(!RB||!RB.createResidentBridge)return;
  var qp=new URLSearchParams(location.search);
  if(qp.get('view')==='saved'||qp.get('view')==='benefits')return;
  var cfg=RB.serverConfig();
  if(!cfg.enabled)return;
  var bridge=RB.createResidentBridge({apiBase:cfg.apiBase,complexSlug:cfg.complexSlug});
  var TAB_TYPE={posts:'posts',comments:'comments',likes:'reactions',reviews:'reviews'};
  var TYPE_LABEL={post:'게시글',comment:'댓글',reply:'답글',reaction:'공감',review:'가게 후기'};
  var STATUS_LABEL={published:'공개',pending_review:'검토 중',active:'공개',hidden:'숨김',deleted:'삭제됨',resolved:'해결됨'};
  var counts={posts:null,comments:null};
  function fmtDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?(m[1]+'.'+m[2]+'.'+m[3]):'';}
  function mapItem(it){
    return [TYPE_LABEL[it.type]||'활동', fmtDate(it.occurredAt), STATUS_LABEL[it.status]||'', (it.title||'제목 없음'), (it.bodyPreview||''), ''];
  }
  function countText(tab){
    if(tab==='posts'||tab==='comments')return counts[tab]==null?'—':('전체 '+counts[tab]+'개');
    return '—';
  }
  var toolbar=document.querySelector('.toolbar');if(toolbar)toolbar.style.display='none';
  document.querySelectorAll('.summary-stat small').forEach(function(s){if(/이번 달/.test(s.textContent))s.style.display='none';});
  function setStat(i,v){var b=document.querySelectorAll('.summary-stat b')[i];if(b)b.textContent=v;}
  function setTabSpan(tab,v){var el=document.querySelector('.tab[data-tab="'+tab+'"] span');if(el)el.textContent=v;}
  function listState(msg){var r=document.querySelector('.rows');if(r)r.innerHTML='';var e=document.querySelector('.empty');if(e){e.textContent=msg;e.style.display='grid';}}
  function applyCountsToDom(){
    setStat(0,counts.posts==null?'—':counts.posts);
    setStat(1,counts.comments==null?'—':counts.comments);
    setStat(2,'—');setStat(3,'—');
    setTabSpan('posts',counts.posts==null?'—':counts.posts);
    setTabSpan('comments',counts.comments==null?'—':counts.comments);
    setTabSpan('likes','—');setTabSpan('reviews','—');
    var lc=document.querySelector('.list-count');if(lc)lc.textContent=countText(current);
    if(data[current])data[current].count=countText(current);
  }
  function loadTab(tab){
    var apiType=TAB_TYPE[tab]||'all';
    current=tab;
    data[tab].items=[];data[tab].count=countText(tab);
    listState('불러오는 중…');
    bridge.activity(apiType,50).then(function(res){
      if(res.mode==='auth-required'){data[tab].items=[];if(current===tab){document.querySelector('.list-count').textContent='—';listState('로그인 후 다시 시도해 주세요.');}return;}
      if(res.ok===false){data[tab].items=[];if(current===tab){document.querySelector('.list-count').textContent='—';listState('잠시 후 다시 시도해 주세요.');}return;}
      data[tab].items=(res.items||[]).map(mapItem);
      data[tab].count=countText(tab);
      if(current===tab){render(tab);}
    }).catch(function(){if(current===tab){listState('잠시 후 다시 시도해 주세요.');}});
  }
  var tabsEl=document.querySelector('.tabs');
  if(tabsEl)tabsEl.addEventListener('click',function(ev){
    var b=ev.target.closest('.tab');if(!b)return;
    ev.preventDefault();ev.stopImmediatePropagation();
    document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
    b.classList.add('active');
    loadTab(b.dataset.tab);
  },true);
  bridge.summary().then(function(s){
    if(s.ok&&s.summary){counts.posts=s.summary.postCount;counts.comments=s.summary.commentCount;}
    applyCountsToDom();
  }).catch(function(){applyCountsToDom();});
  var activeTab=document.querySelector('.tab.active');
  loadTab(activeTab?activeTab.dataset.tab:'posts');
})();
