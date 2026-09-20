(function(global){
  'use strict';

  const COMPLEX_SLUG='banglim-myeongji-roadhill';

  function baseFor(options){
    if(options&&options.apiBase!==undefined)return String(options.apiBase||'').replace(/\/+$/,'');
    return global.DanjionSession&&global.DanjionSession.danjionApiBase
      ? String(global.DanjionSession.danjionApiBase()||'').replace(/\/+$/,'')
      : '';
  }

  function normalizeCode(value){
    return String(value||'').trim().toUpperCase().replace(/[\s-]+/g,'');
  }

  function create(options={}){
    const session=global.DanjionSession;
    const fetchImpl=options.fetchImpl||global.fetch.bind(global);
    const apiBase=baseFor(options);
    const canonicalProduction=!!session&&typeof session.isCanonicalProduction==='function'&&session.isCanonicalProduction(options.location);
    const slug=String(options.complexSlug||COMPLEX_SLUG);

    async function status(){
      if(!apiBase&&!canonicalProduction)return {state:'unbound'};
      const result=await session.request(
        fetchImpl,
        session.joinUrl(apiBase,'/api/v1/complexes/'+encodeURIComponent(slug)+'/household')
      );
      const code=result&&result.error&&result.error.code?String(result.error.code):'';
      if(result.ok){
        const unit=result.data&&result.data.unit||{};
        const membership=result.data&&result.data.myMembership||{};
        const verified=String(membership.status||'')==='verified'||membership.residentVerified===true;
        return {
          state:verified?'verified':'unverified-associated',
          status:result.status,
          buildingCode:String(unit.buildingCode||''),
          unitCode:String(unit.unitCode||''),
          membershipRole:String(membership.membershipRole||'member')
        };
      }
      if(result.status===401)return {state:'signed-out',status:401,code};
      if(result.status===403&&code==='HOUSEHOLD_ASSOCIATION_REQUIRED')return {state:'unverified',status:403,code};
      if(result.reason==='network-error'||result.status===0)return {state:'network-error',status:0,code};
      return {state:'error',status:Number(result.status||0),code};
    }

    async function verify(rawCode){
      if(!apiBase&&!canonicalProduction)return {state:'unbound'};
      const code=normalizeCode(rawCode);
      if(!/^[A-Z0-9]{6,12}$/.test(code))return {state:'invalid-input',code:'RESIDENT_CODE_INVALID'};
      const result=await session.request(
        fetchImpl,
        session.joinUrl(apiBase,'/api/v1/complexes/'+encodeURIComponent(slug)+'/resident-verification/code'),
        {method:'POST',body:JSON.stringify({code})}
      );
      const errorCode=result&&result.error&&result.error.code?String(result.error.code):'';
      if(result.ok){
        const household=result.data&&result.data.household||{};
        return {
          state:'verified',
          status:result.status,
          buildingCode:String(household.buildingCode||''),
          unitCode:String(household.unitCode||''),
          alreadyVerified:result.data&&result.data.alreadyVerified===true
        };
      }
      if(result.status===401)return {state:'signed-out',status:401,code:errorCode};
      if(result.status===409&&errorCode==='RESIDENT_CODE_INVALID')return {state:'invalid-code',status:409,code:errorCode};
      if(result.status===429)return {state:'rate-limited',status:429,code:errorCode};
      if(result.status===503)return {state:'unavailable',status:503,code:errorCode};
      if(result.reason==='network-error'||result.status===0)return {state:'network-error',status:0,code:errorCode};
      return {state:'error',status:Number(result.status||0),code:errorCode};
    }

    async function support(input={}){
      if(!apiBase&&!canonicalProduction)return {state:'unbound'};
      const inquiryRuntime=global.DanjionInquiryBridge;
      if(!inquiryRuntime||typeof inquiryRuntime.createInquiryBridge!=='function')return {state:'error',code:'INQUIRY_BRIDGE_UNAVAILABLE'};
      const buildingCode=String(input.buildingCode||'').trim();
      const unitCode=String(input.unitCode||'').trim();
      const name=String(input.name||'').trim();
      const contact=String(input.contact||'').trim();
      const reason=String(input.reason||'').trim();
      const kind=String(input.kind||'request')==='question'?'question':'request';
      if(!buildingCode||!unitCode||!name||!contact||!reason)return {state:'invalid-input',code:'SUPPORT_FIELDS_REQUIRED'};
      const inquiry=inquiryRuntime.createInquiryBridge({apiBase,complexSlug:slug,fetchImpl});
      const subject=kind==='question'?'주민인증 문의':'주민인증 코드 요청';
      const text=[
        '[주민인증 지원 요청]',
        '동: '+buildingCode,
        '호: '+unitCode,
        '이름: '+name,
        '연락처: '+contact,
        '사유: '+reason
      ].join('\n');
      const result=await inquiry.submitGeneral({
        inquiryType:'resident_verification_code_request',
        subject,
        text
      });
      if(result.mode==='server')return {state:'submitted',status:result.status,inquiry:result.inquiry};
      if(result.mode==='auth-required')return {state:'signed-out',status:result.status,code:result.error};
      if(result.mode==='resident-verification-required')return {state:'error',status:result.status,code:result.error};
      if(result.mode==='client')return {state:'invalid-input',status:0,code:result.error};
      if(result.status===429)return {state:'rate-limited',status:429,code:result.error};
      return {state:'error',status:Number(result.status||0),code:result.error||''};
    }

    return {status,verify,support,normalizeCode};
  }

  global.DanjionResidentVerificationCode=Object.freeze({COMPLEX_SLUG,normalizeCode,create});
})(typeof window!=='undefined'?window:globalThis);
