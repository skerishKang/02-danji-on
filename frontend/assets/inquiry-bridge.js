(()=>{
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function normalizeBase(value){
    const text=String(value||'').trim().replace(/\/$/,'');
    return text||location.origin;
  }

  function businessIdFromKey(key){
    const text=String(key||'').trim();
    if(!text.startsWith('api-'))return null;
    const id=text.slice(4).toLowerCase();
    return UUID.test(id)?id:null;
  }

  function normalizeInquiry(raw){
    if(!raw||typeof raw!=='object')return null;
    return {
      id:String(raw.id||''),
      inquiryType:String(raw.inquiryType??raw.inquiry_type??''),
      title:String(raw.title||''),
      body:String(raw.body||''),
      status:String(raw.status||''),
      response:raw.response??null,
      answeredAt:raw.answeredAt??raw.answered_at??null,
      closedAt:raw.closedAt??raw.closed_at??null,
      createdAt:raw.createdAt??raw.created_at??null,
      updatedAt:raw.updatedAt??raw.updated_at??null
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

  function createInquiryBridge(options={}){
    const fetchImpl=options.fetchImpl||fetch.bind(globalThis);
    const apiBase=normalizeBase(options.apiBase);
    const complexSlug=String(options.complexSlug||'banglim-myeongji-roadhill');

    async function submit(input={}){
      const businessId=businessIdFromKey(input.shopKey);
      if(!businessId)return {ok:false,mode:'static',error:'SERVER_BUSINESS_ID_REQUIRED'};
      const subject=String(input.subject||'').trim();
      const text=String(input.text||'').trim();
      const shopName=String(input.shopName||'').trim();
      if(!subject||!text)return {ok:false,mode:'client',error:'INQUIRY_FIELDS_REQUIRED'};
      const body=shopName?`[${shopName}] ${text}`:text;
      const result=await requestJson(fetchImpl,`${apiBase}/api/v1/me/inquiries`,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({complexSlug,inquiryType:'shop_inquiry',title:subject,body})
      });
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error'};
      return {ok:true,mode:'server',status:result.status,inquiry:normalizeInquiry(result.data)};
    }

    async function listMine(){
      const result=await requestJson(fetchImpl,`${apiBase}/api/v1/me/inquiries`,{method:'GET'});
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error',inquiries:[]};
      const rows=Array.isArray(result.data?.inquiries)?result.data.inquiries:[];
      return {mode:'server',status:result.status,inquiries:rows.map(normalizeInquiry).filter(Boolean)};
    }

    return {submit,listMine,businessIdFromKey};
  }

  globalThis.DanjionInquiryBridge={createInquiryBridge,businessIdFromKey,normalizeInquiry};
})();
