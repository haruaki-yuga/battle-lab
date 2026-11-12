/**
 * Battle Lab public character importer: Cloudflare Worker
 * 1. Replace YOUR_GITHUB_USERNAME with your GitHub username.
 * 2. Deploy via Cloudflare dashboard; copy *.workers.dev URL into
 *    battle_lab/character-api-config.js before publishing GitHub Pages.
 * Only a fixed public GraphQL query is made to the official site.
 */
const ALLOWED_ORIGINS = new Set([
  'https://YOUR_GITHUB_USERNAME.github.io',
  // Example for a custom domain / future embedding (uncomment and edit if needed):
  // 'https://example.com',
]);
const OFFICIAL_GRAPHQL = 'https://rev2.reversion.jp/graphql?opname=GetCharacterDetail';
const CHARACTER_QUERY = `query GetCharacterDetail($character_id: String!) {
 character: rev2GetCharacterDetail(character_id: $character_id) {
  character_id name level
  sub_status { id type name abbr value }
  skills {
   a { ...Skill active { category ap_cost ticks power hit critical fumble } }
   p { ...Skill }
   ex_a { ...Skill active { category ap_cost ticks power hit critical fumble } }
  }
  classes { ...Skill } esprits { ...Skill }
 }
}
fragment Skill on Rev2CharacterSpecField {
 id name description display_effects specialization_base { name }
}`;
const json = (obj,status=200,headers={}) => new Response(JSON.stringify(obj),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}
});
function cors(origin){return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'3600','Vary':'Origin'};}
async function readLimited(response,limit){
  if(Number(response.headers.get('Content-Length'))>limit)throw Error('取得データが大きすぎます。');
  const reader=response.body?.getReader();if(!reader)throw Error('応答を読み込めません。');
  let length=0;const parts=[];
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;
      if(length>limit)throw Error('取得データが大きすぎます。');parts.push(value);}
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
function parseURL(value){
  let url;try{url=new URL(String(value||'').trim());}catch{throw Error('キャラクターURLを入力してください。');}
  const match=url.pathname.match(/^\/character\/detail\/(r2p\d{6})\/?$/);
  if(url.protocol!=='https:'||url.hostname!=='rev2.reversion.jp'||url.port||url.username||url.password||!match)throw Error('公式サイトのキャラクター詳細URLを入力してください。');
  return match[1];
}
export default {
  async fetch(request){
    const url=new URL(request.url);
    const origin=request.headers.get('Origin')||'';
    if(url.pathname!=='/character')return json({error:'ページが見つかりません。'},404);
    if(!ALLOWED_ORIGINS.has(origin))return json({error:'この公開サイトからの取得は許可されていません。'},403);
    const responseHeaders=cors(origin);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:responseHeaders});
    if(request.method!=='POST')return json({error:'POST専用です。'},405,responseHeaders);
    if(!request.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON形式で送信してください。'},415,responseHeaders);
    let id;
    try{
      if(Number(request.headers.get('Content-Length'))>2000)throw Error('入力データが大きすぎます。');
      const payload=await readLimited(request,2000);id=parseURL(payload.url);
    }catch(err){return json({error:err.message||'URLが正しくありません。'},400,responseHeaders);}
    try{
      const upstream=await fetch(OFFICIAL_GRAPHQL,{
        method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({operationName:'GetCharacterDetail',query:CHARACTER_QUERY,variables:{character_id:id}}),
        redirect:'manual',signal:AbortSignal.timeout(20000),
      });
      if(!upstream.ok)return json({error:upstream.status===429?'公式サイトが混み合っています。時間をおいて再試行してください。':`公式サイトから取得できませんでした（HTTP ${upstream.status}）。`},502,responseHeaders);
      if(!upstream.headers.get('Content-Type')?.toLowerCase().includes('json'))return json({error:'公式サイトからJSONが返りませんでした。'},502,responseHeaders);
      const data=await readLimited(upstream,2000000);
      if(data?.data?.character?.character_id!==id)return json({error:'キャラクターが非公開または見つかりません。'},404,responseHeaders);
      return json(data,200,responseHeaders);
    }catch(err){return json({error:err.name==='TimeoutError'?'公式サイトとの通信がタイムアウトしました。':'公式サイトの通信が失敗しました。時間をおいて再試行してください。'},502,responseHeaders);}
  },
};
