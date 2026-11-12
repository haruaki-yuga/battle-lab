import {STAT_LABELS,EFFECTS,RANGES,clone,arrangeInitialPositions,validateConfig} from './model.js';
import {parseCharacterURL,parseCharacterData,createImportedUnit} from './character-import.js';
import {deduplicateImportedSkills} from './skill-dedup.js';
import {DEFAULT_CHARACTER_WORKER_URL} from './character-api-config.js';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urlPlaceholder='https://rev2.reversion.jp/character/detail/r2p000000';
const number=n=>Number(n).toLocaleString('ja-JP');
export function characterAPIEndpoint(value){
 let u;try{u=new URL(String(value||'').trim());}catch{throw Error('Cloudflare WorkerのURLを入力してください。');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('Workerにはhttps://から始まる公開URLを指定してください。');
 return new URL('/character',u.origin).href;
}


export function createCharacterImporter({getConfig,getCurrent,onApply}){
 const dialog=document.createElement('dialog');dialog.className='character-import-modal';dialog.setAttribute('aria-labelledby','character-import-title');document.body.append(dialog);
 let state,controller,seq=0;
 const button=(label,act,cls='',disabled=false)=>`<button data-import-action="${act}" class="${cls}" ${disabled?'disabled':''}>${label}</button>`;
 const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
 function render(){
  const p=state.profile,config=getConfig(),target=config.units.find(u=>u.id===state.replaceId),supported=p?.skills.filter(s=>s.supported)||[];
  dialog.innerHTML=`<div class="modal-header"><div><div class="eyebrow">CHARACTER IMPORT</div><h2 id="character-import-title">キャラURLから読み込む</h2></div>${button('×','close','ghost')}</div><div class="modal-form"><p class="subtitle">公開中の能力値・装備アクティブスキル・常時特殊効果を取得します。</p><form id="character-url-form"><label class="field"><span>キャラクター詳細ページのURL</span><input type="url" id="character-source-url" value="${esc(state.url)}" placeholder="${urlPlaceholder}" required autocomplete="off"></label><div class="btnrow" style="margin-top:12px">${button(state.loading?'読み込み中…':'内容を取得','fetch','primary',state.loading)}</div></form>${state.error?`<div class="error-box import-feedback" role="alert">${esc(state.error)}</div>`:''}${state.loading?'<p class="import-feedback" role="status">公開ページから読み込んでいます…</p>':''}${p?`<section class="import-preview"><div class="import-profile-heading"><div><div class="eyebrow">${esc(p.characterId)}${Number.isFinite(p.level)?` / Lv. ${p.level}`:''}</div><h3>${esc(p.name)}</h3></div><a href="${esc(p.sourceURL)}" target="_blank" rel="noopener noreferrer">元のページ ↗</a></div><div class="import-stat-grid">${Object.entries(STAT_LABELS).map(([k,label])=>`<div><span>${label}</span><strong>${p.stats[k]===undefined?'未取得':number(p.stats[k])}</strong></div>`).join('')}</div><div class="notice">公式プロフィールに表示された能力値を使用します。補正は再加算しません。</div><h3 class="import-section-title">装備アクティブ <span class="rule-count">${supported.length} / ${p.skills.length} 件をセット可能</span></h3>${p.skills.length?p.skills.map(r=>`<details class="import-skill"><summary><span>${esc(r.name)}${r.baseName?`<small>元スキル：${esc(r.baseName)}</small>`:''}</span><span class="pill ${r.supported?'green':'red'}">${r.supported?`AP ${number(r.skill.ap)} · 行動値 ${number(r.skill.cost)}`:'未対応・セット対象外'}</span></summary><p class="source-quote">${esc(r.original)}</p>${r.issues.length?`<p class="import-warning">未対応：${r.issues.map(esc).join('、')}</p>`:''}</details>`).join(''):'<p class="subtle">装備中のアクティブスキルはありません。</p>'}<h3 class="import-section-title">常時特殊効果</h3><div class="skill-tags">${Object.entries(p.effects).length?Object.entries(p.effects).map(([k,v])=>`<span class="pill">${esc(EFFECTS[k])} ${number(v)}</span>`).join(''):'<span class="subtle">対応する常時特殊効果はありません。</span>'}</div>${p.warnings.length?`<div class="import-warning-box" role="status"><b>読み込み内容の確認</b><ul>${p.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}<div class="import-destination fields two"><label class="field"><span>反映先</span><select id="character-destination">${option('add','新しいキャラとして追加',state.replaceId)}${config.units.map(u=>option(u.id,`${u.name} を置き換える`,state.replaceId)).join('')}</select></label><label class="field"><span>陣営</span><select id="character-team">${option('A','チームA / 自チーム',state.team)}${option('B','チームB / 相手チーム',state.team)}</select></label><label class="field"><span>通常攻撃の射程（手動指定）</span><select id="character-normal-range">${Object.entries(RANGES).filter(([k])=>k!=='special').map(([k,v])=>option(k,v,state.normalRange)).join('')}</select></label></div><p class="footnote">射程・消費AP・威力・特殊効果などの性能が一致するWIKIスキルは、名前が違っていても元のIDを再利用し、特殊化名はこのキャラだけに表示します。一致しないスキルは編集できるアクセルカレイドとして登録します。通常攻撃の射程・キャラAI設定は公開データから取得できません。射程を確認してください。行動ルールは「効果的な攻撃 → 行動値持ち越し」で開始します。</p>${target?`<p class="import-warning">「${esc(target.name)}」の数値・装備・キャラAI設定を置き換えます。初期位置は引き継ぎます。</p>`:''}<p class="footnote">取得日時：${esc(new Date(p.fetchedAt).toLocaleString('ja-JP'))} / 取得後の変更は再読み込みで反映</p></section>`:''}</div><div class="modal-footer">${button('キャンセル','close')}${p?button(target?'このキャラを置き換える':'編成に追加する','apply','primary',state.loading||p.missing.length>0):''}</div>`;
  dialog.querySelector('#character-url-form').addEventListener('submit',e=>{e.preventDefault();fetchProfile();});
  dialog.querySelectorAll('button').forEach(b=>b.type='button');
 }
 async function fetchProfile(){
  controller?.abort();const turn=++seq;state.error='';state.profile=null;
  try{state.url=parseCharacterURL(state.url).url;}catch(e){state.error=e.message;render();return;}
  state.loading=true;render();controller=new AbortController();const activeController=controller;const timer=setTimeout(()=>activeController.abort(),25000);
  try{
   const endpoint=characterAPIEndpoint(DEFAULT_CHARACTER_WORKER_URL);
   const r=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:state.url}),signal:activeController.signal});
   let data;try{data=await r.json();}catch{throw Error('読み込み機能に接続できませんでした。ページを再読み込みしてお試しください。');}
   if(!r.ok||!data.data)throw Error(data.error||'公開データを取得できませんでした。Workerの設定や公開プロフィールを確認してください。');
   const profile=parseCharacterData(data,state.url);
   if(turn===seq)state.profile=profile;
  }catch(e){if(turn===seq)state.error=e.name==='AbortError'?'時間内に取得できませんでした。再度お試しください。':e instanceof TypeError?'取得サーバーへ接続できません。公式サイトの通信状態を確認してください。':e.message;}
  finally{clearTimeout(timer);if(turn===seq){state.loading=false;render();}}
 }
 dialog.addEventListener('input',e=>{if(e.target.id==='character-source-url'){state.url=e.target.value;if(state.profile||state.loading){controller?.abort();seq++;state.profile=null;state.loading=false;const pos=e.target.selectionStart;render();const input=dialog.querySelector('#character-source-url');input.focus();try{input.setSelectionRange(pos,pos);}catch{}}}});
 dialog.addEventListener('change',e=>{if(e.target.id==='character-destination'){state.replaceId=e.target.value;const u=getConfig().units.find(u=>u.id===state.replaceId);if(u){state.team=u.team;state.normalRange=u.normalRange==='special'?'near':u.normalRange;}render();}if(e.target.id==='character-team')state.team=e.target.value;if(e.target.id==='character-normal-range')state.normalRange=e.target.value;});
 dialog.addEventListener('click',e=>{const b=e.target.closest('[data-import-action]');if(!b||b.disabled)return;const a=b.dataset.importAction;
  if(a==='close'){seq++;controller?.abort();dialog.close();return;}
  if(a==='fetch'){fetchProfile();return;}
  if(a==='apply'){
   try{const config=clone(getConfig()),replace=config.units.find(u=>u.id===state.replaceId);if(!replace&&config.units.length>=16)throw Error('編成は最大16人です。反映先で既存のキャラを選んでください。');
    deduplicateImportedSkills(config);
    const {unit,skills,reused,renamed,drafts}=createImportedUnit(state.profile,{team:state.team,normalRange:state.normalRange,replace,count:config.units.filter(u=>u.team===state.team).length,existingSkills:config.skills});
    config.skills.push(...skills);if(replace)config.units[config.units.findIndex(u=>u.id===replace.id)]=unit;else config.units.push(unit);
    if(!replace||replace.team!==unit.team)arrangeInitialPositions(config.units);
    const errors=validateConfig(config);if(errors.length)throw Error(errors.join(' / '));
    onApply(config,unit,{added:skills.length-drafts,reused,renamed,drafts});seq++;controller?.abort();dialog.close();
   }catch(e){state.error=e.message;render();}
  }
 });
 dialog.addEventListener('cancel',()=>{seq++;controller?.abort();});
 return ()=>{const u=getCurrent();state={url:u.importedProfile?.url||'',profile:null,error:'',loading:false,replaceId:'add',team:u.team,normalRange:u.normalRange==='special'?'near':u.normalRange};render();dialog.showModal();};
}
