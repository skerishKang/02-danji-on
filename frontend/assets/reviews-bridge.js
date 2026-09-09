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

  function endpoint(apiBase,complexSlug,businessId,suffix=''){
    return `${normalizeBase(apiBase)}/api/v1/complexes/${encodeURIComponent(complexSlug)}/businesses/${businessId}/reviews${suffix}`;
  }

  function normalizeReview(raw){
    if(!raw||typeof raw!=='object')return null;
    const author=raw.author&&typeof raw.author==='object'?raw.author:{};
    const reply=raw.reply&&typeof raw.reply==='object'?raw.reply:null;
    return {
      id:String(raw.id||''),
      body:String(raw.body||''),
      isMine:Boolean(raw.isMine),
      author:{
        userId:String(author.userId||''),
        nickname:String(author.nickname||''),
        avatarUrl:author.avatarUrl==null?null:String(author.avatarUrl)
      },
      reply:reply?{
        body:String(reply.body||''),
        createdAt:reply.createdAt??null,
        updatedAt:reply.updatedAt??null
      }:null,
      createdAt:raw.createdAt??null,
      updatedAt:raw.updatedAt??null
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

  function createReviewsBridge(options={}){
    const fetchImpl=options.fetchImpl||fetch.bind(globalThis);
    const apiBase=normalizeBase(options.apiBase);
    const complexSlug=String(options.complexSlug||'banglim-myeongji-roadhill');

    async function list(shopKey){
      const businessId=businessIdFromKey(shopKey);
      if(!businessId)return {mode:'static',businessId:null,reviews:[]};
      const result=await requestJson(fetchImpl,endpoint(apiBase,complexSlug,businessId),{method:'GET'});
      if(!result.ok){
        const authRequired=[401,403].includes(result.status);
        return {mode:authRequired?'auth-required':'error',businessId,reviews:[],status:result.status,error:result.error};
      }
      const rows=Array.isArray(result.data?.reviews)?result.data.reviews:[];
      return {mode:'server',businessId,reviews:rows.map(normalizeReview).filter(Boolean),status:result.status};
    }

    async function create(shopKey,body){
      const businessId=businessIdFromKey(shopKey);
      if(!businessId)return {ok:false,mode:'static',error:'SERVER_BUSINESS_ID_REQUIRED'};
      const text=String(body||'').trim();
      if(!text)return {ok:false,mode:'client',error:'REVIEW_BODY_REQUIRED'};
      const result=await requestJson(fetchImpl,endpoint(apiBase,complexSlug,businessId),{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:text})
      });
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error'};
      return {ok:true,mode:'server',status:result.status,review:normalizeReview(result.data)};
    }

    async function update(shopKey,reviewId,body){
      const businessId=businessIdFromKey(shopKey);
      const rid=String(reviewId||'').toLowerCase();
      if(!businessId||!UUID.test(rid))return {ok:false,mode:'client',error:'VALID_IDS_REQUIRED'};
      const text=String(body||'').trim();
      if(!text)return {ok:false,mode:'client',error:'REVIEW_BODY_REQUIRED'};
      const result=await requestJson(fetchImpl,endpoint(apiBase,complexSlug,businessId,`/${rid}`),{
        method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({body:text})
      });
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error'};
      return {ok:true,mode:'server',status:result.status,review:normalizeReview(result.data)};
    }

    async function remove(shopKey,reviewId){
      const businessId=businessIdFromKey(shopKey);
      const rid=String(reviewId||'').toLowerCase();
      if(!businessId||!UUID.test(rid))return {ok:false,mode:'client',error:'VALID_IDS_REQUIRED'};
      const result=await requestJson(fetchImpl,endpoint(apiBase,complexSlug,businessId,`/${rid}`),{method:'DELETE'});
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error'};
      return {ok:true,mode:'server',status:result.status,deleted:Boolean(result.data?.deleted),reviewId:rid};
    }

    async function reply(shopKey,reviewId,body){
      const businessId=businessIdFromKey(shopKey);
      const rid=String(reviewId||'').toLowerCase();
      if(!businessId||!UUID.test(rid))return {ok:false,mode:'client',error:'VALID_IDS_REQUIRED'};
      const text=String(body||'').trim();
      if(!text)return {ok:false,mode:'client',error:'REVIEW_BODY_REQUIRED'};
      const result=await requestJson(fetchImpl,endpoint(apiBase,complexSlug,businessId,`/${rid}/reply`),{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:text})
      });
      if(!result.ok)return {...result,mode:[401,403].includes(result.status)?'auth-required':'error'};
      return {ok:true,mode:'server',status:result.status,reply:{
        reviewId:String(result.data?.reviewId||rid),businessId:String(result.data?.businessId||businessId),
        body:String(result.data?.body||''),createdAt:result.data?.createdAt??null,updatedAt:result.data?.updatedAt??null
      }};
    }

    return {businessIdFromKey,list,create,update,remove,reply};
  }

  globalThis.DanjionReviewsBridge={createReviewsBridge,businessIdFromKey,normalizeReview};
})();
