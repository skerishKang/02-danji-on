(function(global){
  'use strict';

  function ensureStyle(){
    if(document.getElementById('danjion-service-footer-style'))return;
    const style=document.createElement('style');
    style.id='danjion-service-footer-style';
    style.textContent=`
      .danjion-service-footer{
        border-top:1px solid var(--line,#d8d0c3);
        background:var(--paper-2,#fffdf8);
        color:var(--ink,#101317);
        margin-top:56px;
      }
      .danjion-service-footer-inner{
        width:min(1440px,calc(100% - 80px));
        margin:auto;
        padding:34px 0 38px;
        display:grid;
        grid-template-columns:minmax(260px,.8fr) minmax(360px,1.6fr) auto;
        gap:36px;
        align-items:start;
      }
      .danjion-service-footer-brand{
        display:flex;
        flex-direction:column;
        gap:7px;
      }
      .danjion-service-footer-brand strong{
        font-size:20px;
        line-height:1;
        font-weight:950;
        letter-spacing:-.04em;
      }
      .danjion-service-footer-brand small{
        font-size:10px;
        line-height:1.3;
        font-weight:850;
        letter-spacing:.12em;
        color:#77726a;
      }
      .danjion-service-footer-copy{
        margin:0;
        max-width:660px;
        font-size:13px;
        line-height:1.7;
        color:#625e57;
        word-break:keep-all;
      }
      .danjion-service-footer-links{
        display:flex;
        flex-wrap:wrap;
        justify-content:flex-end;
        gap:14px;
      }
      .danjion-service-footer-links a{
        color:inherit;
        font-size:12px;
        line-height:1.4;
        font-weight:850;
        text-decoration:none;
        border-bottom:1px solid currentColor;
        padding-bottom:2px;
      }
      @media(max-width:760px){
        .danjion-service-footer{margin-top:36px;margin-bottom:76px}
        .danjion-service-footer-inner{
          width:calc(100% - 40px);
          padding:28px 0 30px;
          grid-template-columns:1fr;
          gap:18px;
        }
        .danjion-service-footer-links{justify-content:flex-start}
      }
    `;
    document.head.append(style);
  }

  function createFooter(){
    const footer=document.createElement('footer');
    footer.className='danjion-service-footer';
    footer.setAttribute('data-danjion-service-footer','');
    footer.setAttribute('aria-label','단지온 서비스 안내');

    const inner=document.createElement('div');
    inner.className='danjion-service-footer-inner';

    const brand=document.createElement('div');
    brand.className='danjion-service-footer-brand';
    const title=document.createElement('strong');
    title.textContent='단지온';
    const by=document.createElement('small');
    by.textContent='DANJION by PADIEM';
    brand.append(title,by);

    const copy=document.createElement('p');
    copy.className='danjion-service-footer-copy';
    copy.textContent='단지온은 우리 단지의 소식, 이웃가게, 주민 활동과 생활 정보를 한곳에서 연결하는 아파트 생활 서비스입니다.';

    const links=document.createElement('nav');
    links.className='danjion-service-footer-links';
    links.setAttribute('aria-label','서비스 안내 링크');
    const intro=document.createElement('a');
    intro.href='index.html?intro=1';
    intro.textContent='서비스 소개';
    const inquiry=document.createElement('a');
    inquiry.href='25_1대1문의.html';
    inquiry.textContent='1:1 문의';
    links.append(intro,inquiry);

    inner.append(brand,copy,links);
    footer.append(inner);
    return footer;
  }

  function mount(){
    if(typeof document==='undefined')return false;
    if(!document.querySelector('.danjion-service-header'))return false;
    if(document.querySelector('[data-danjion-service-footer]'))return true;
    ensureStyle();
    const footer=createFooter();
    const mobileNav=document.querySelector('.mobile-bottom');
    if(mobileNav&&mobileNav.parentNode===document.body)document.body.insertBefore(footer,mobileNav);
    else document.body.append(footer);
    return true;
  }

  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
    else mount();
  }

  global.DanjionServiceFooter=Object.freeze({mount});
})(typeof window!=='undefined'?window:globalThis);
