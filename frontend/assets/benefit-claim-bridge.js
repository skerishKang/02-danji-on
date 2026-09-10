(()=>{
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function normalizeBase(value){
    const text=String(value||'').trim().replace(/\/$/,'');
    return text||location.origin;
  }

  function benefitIdFromValue(value){
    const text=String(value==null?'':value).trim().toLowerCase();
    return UUID.test(text)?text:null;
  }

  function normalizeClaim(raw){
    if(!raw||typeof raw!=='object')return null;
    return {
      id:String(raw.id||''),
      benefitId:String(raw.benefit_id??raw.benefitId??''),
      claimCode:String(raw.claim_code??raw.claimCode??''),
      status:String(raw.status||''),
      claimedAt:raw.claimed_at??raw.claimedAt??null,
      usedAt:raw.used_at??raw.usedAt??null
    };
  }

  function normalizeWalletRow(raw){
    if(!raw||typeof raw!=='object')return null;
    return {
      id:String(raw.id||''),
      benefitId:String(raw.benefit_id??raw.benefitId??''),
      claimCode:String(raw.claim_code??raw.claimCode??''),
      status:String(raw.status||''),
      claimedAt:raw.claimed_at??raw.claimedAt??null,
      usedAt:raw.used_at??raw.usedAt??null,
      title:String(raw.title||''),
      description:String(raw.description||''),
      conditions:raw.conditions??null,
      businessId:String(raw.business_id??raw.businessId??''),
      businessName:String(raw.business_name??raw.businessName??''),
      complexSlug:String(raw.complex_slug??raw.complexSlug??''),
      complexName:String(raw.complex_name??raw.complexName??'')
    };
  }

  async function requestJson(fetchImpl,url,init){
    let response;
    try{response=await fetchImpl(url,{credentials:'include',...init})}
    catch(error){return {ok:false,status:0,error:'NETWORK_ERROR',cause:error}}
    let payload=null;
    try{payload=await response.json()}catch(_){payload=null}
    if(!response.ok){
      return {ok:false,status:response.status,error:payload?.error?.code||`HTTP_${response.status}`,payload};
    }
    return {ok:true,status:response.status,data:payload?.data??null,payload};
  }

  function createBenefitClaimBridge(options={}){
    const fetchImpl=options.fetchImpl||fetch.bind(globalThis);
    const apiBase=normalizeBase(options.apiBase);
    const complexSlug=String(options.complexSlug||'banglim-myeongji-roadhill');

    async function claim(benefitId){
      const id=benefitIdFromValue(benefitId);
      if(!id)return {ok:false,mode:'static',error:'BENEFIT_ID_REQUIRED'};
      const result=await requestJson(fetchImpl,`${apiBase}/api/v1/me/benefits/${id}/claim`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({complexSlug})
      });
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error'};
      return {ok:true,mode:'server',status:result.status,claim:normalizeClaim(result.data)};
    }

    async function listMine(){
      const result=await requestJson(fetchImpl,`${apiBase}/api/v1/me/benefits`,{method:'GET'});
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error',benefits:[]};
      const rows=Array.isArray(result.data)?result.data:[];
      return {mode:'server',status:result.status,benefits:rows.map(normalizeWalletRow).filter(Boolean)};
    }

    return {claim,listMine};
  }

  globalThis.DanjionBenefitClaimBridge={createBenefitClaimBridge,benefitIdFromValue,normalizeClaim,normalizeWalletRow};
})();
