import {freshUnit, freshRule, freshCondition} from './model.js';

// All preset skills refer to the protected, original 220 WIKI A-skills.
// Presets produce normal editable units and are not added to the skill catalog.
export const ENEMY_PRESETS = Object.freeze({
 weak: {name:'弱い敵', description:'低耐久・低命中。射撃と通常攻撃で戦う入門用。'},
 medium: {name:'そこそこ強い敵', description:'中堅の遠近攻撃型。HPが減ると回復を優先。'},
 strong: {name:'かなり強い敵', description:'高火力・高耐久。自己強化、緊急回復、AP・BS対策、味方支援、距離調整、弱点狙いを切り替える上級AI。'},
 kite: {name:'引き撃ちする敵', description:'機動力10。能力値はそこそこ強い敵と同等。全射程の敵に対応。行動値210以上のときだけ超遠通常攻撃し、割り込み離脱用の行動値を温存。'},
});

// Shared combat attributes keep the kite preset at the exact mid-tier power level.
const MEDIUM_COMBAT_STATS=Object.freeze({
 maxHp:6400,maxAp:2400,main:620,sub:110,heal:330,hit:74,evade:38,
 defense:48,resist:40,speed:190,critical:11,fumble:4,drama:12
});

const condition=(subject,metric,min,max)=>({...freshCondition(),subject,metric,min,max});
const enemiesAlive=()=>condition('enemies','alive',0,100);
const selfHpBelow=(pct)=>condition('self','hpPct',0,pct);
const targetAtMostHp=(pct)=>condition('enemies','hpPct',0,pct);
// Only data the player can also configure from the normal character AI editor is used.
const selfAPBelow=(pct)=>condition('self','apPct',0,pct);
const selfBSAtLeast=(count)=>condition('self','bsCount',count,99);
const companionsHpBelow=(pct)=>condition('companions','hpPct',0,pct);
const selfNoBuff=()=>condition('self','buffCount',0,0);
const enemyClose=(meters)=>condition('enemies','distance',0,meters);
const enemyDefenseAtLeast=(defense)=>condition('enemies','defense',defense,99999);
const enemyAVAtLeast=(av)=>condition('enemies','av',av,99999);
const safeDistance=()=>condition('enemies','distance',14,99999);
const selfSkill=(skillId,conditions)=>freshRule({conditions,action:'skill',skillId,target:'self',autoMove:false});
const tacticalSkill=(skillId,conditions,options={})=>freshRule({
 conditions,action:'skill',skillId,target:'previous',sort:'nearest',
 autoMove:true,moveMode:'fixed',minDist:16,maxDist:27,...options
});

const aimedSkill=(skillId,range,conditions=[enemiesAlive()])=>freshRule({
 conditions,action:'skill',skillId,target:'previous',sort:'nearest',
 autoMove:true,moveMode:'fixed',minDist:range[0],maxDist:range[1]
});
const fallback=()=>freshRule({conditions:[],action:'attack',target:'enemies',sort:'nearest',
 autoMove:true,moveMode:'fixed',minDist:0,maxDist:8});
const carry=()=>freshRule({conditions:[],action:'carry',target:'self',autoMove:false});
const recover=(skillId,threshold)=>freshRule({
 conditions:[selfHpBelow(threshold)],action:'skill',skillId,target:'self',
 autoMove:false,sort:'nearest'
});
// Always move relative to the nearest threat, independently of the target of a shot.
const kitingShot=(skillId,conditions=[])=>freshRule({
 conditions,action:'skill',skillId,target:'enemies',sort:'nearest',
 autoMove:true,moveMode:'fixed',minDist:25,maxDist:28,
 splitMovement:true,moveTargetMode:'individual',moveSubject:'enemies',
 moveConditions:[enemiesAlive()],moveSort:'nearest',movePriority:'movement'
});

/** Construct an independent preset enemy, including equipped WIKI skills and usable AI. */
export function createSampleEnemy(tier){
 if(!(tier in ENEMY_PRESETS))throw Error(`不明なサンプル敵: ${tier}`);
 const common={name:ENEMY_PRESETS[tier].name,team:'B',sampleEnemyTier:tier,
 startHp:100,startAp:100,x:10,y:0,initialBS:[],immunities:[],effects:{}};
 if(tier==='weak')return freshUnit({...common,
  maxHp:2600,maxAp:850,main:240,sub:45,heal:80,hit:47,evade:20,
  defense:14,resist:12,speed:115,mobility:1,critical:4,fumble:7,drama:4,
  normalRange:'near',skills:['wiki-018'],
  rules:[aimedSkill('wiki-018',[17,28]),fallback(),carry()]
 });
 if(tier==='medium')return freshUnit({...common,
  ...MEDIUM_COMBAT_STATS,
  mobility:2,normalRange:'near',skills:['wiki-043','wiki-064','wiki-201'],
  rules:[recover('wiki-201',42),aimedSkill('wiki-064',[5,9],[targetAtMostHp(50)]),
   aimedSkill('wiki-043',[17,28]),fallback(),carry()]
 });
 if(tier==='kite')return freshUnit({...common,
  // Same combat stats as the mid-tier enemy; only mobility is deliberately higher.
  ...MEDIUM_COMBAT_STATS,
  mobility:10,normalRange:'super',reactiveKite:true,reactiveKiteLimit:3,
  skills:['wiki-079','wiki-120','wiki-086','wiki-205','wiki-220','wiki-196'],
  rules:[
   // Distance is the first priority. Boss-range attacks top out at 30m,
   // while the normal super-range attack stays useful from 37-39m.
   freshRule({conditions:[enemyClose(35)],action:'move',target:'enemies',sort:'nearest',
    autoMove:true,moveMode:'fixed',minDist:37,maxDist:39,
    splitMovement:true,moveTargetMode:'individual',moveSubject:'enemies',
    moveConditions:[enemiesAlive()],moveSort:'nearest',movePriority:'movement'}),
   // Use healing only when the lost HP justifies its action-value cost.
   freshRule({conditions:[selfHpBelow(65)],action:'skill',skillId:'wiki-220',target:'self',autoMove:false}),
   freshRule({conditions:[selfAPBelow(35)],action:'skill',skillId:'wiki-196',target:'self',autoMove:false}),
   // Use only existing AI options. Even against 40m attacks, save enough AV
   // for reactive retreat: a 150 threshold left the unit vulnerable, while
   // 210 balances sustained normal shots with a reliable 40-AV escape.
   freshRule({conditions:[{...freshCondition(),subject:'self',metric:'av',min:210,max:99999},enemiesAlive()],
    action:'attack',target:'enemies',sort:'nearest',
    autoMove:true,moveMode:'fixed',minDist:37,maxDist:39,
    splitMovement:true,moveTargetMode:'individual',moveSubject:'enemies',
    moveConditions:[enemiesAlive()],moveSort:'nearest',movePriority:'movement'}),
   carry()
  ]
 });
 // Advanced boss: substantial stat increase, but no invented skills or unlisted effects.
 return freshUnit({...common,
  maxHp:26000,maxAp:9500,main:1700,sub:420,heal:1400,hit:135,evade:85,
  defense:155,resist:140,speed:375,mobility:5,critical:27,fumble:1,drama:28,
  normalRange:'far',
  skills:['wiki-085','wiki-117','wiki-118','wiki-079',
          'wiki-179','wiki-196','wiki-205','wiki-219','wiki-220'],
  rules:[
   // A critical HP loss takes precedence over offense and resource management.
   selfSkill('wiki-220',[selfHpBelow(28)]),
   // When depleted, a no-AP skill restores some HP/AP.
   selfSkill('wiki-196',[selfAPBelow(8)]),
   selfSkill('wiki-205',[selfBSAtLeast(2)]),
   // Group healing is safe for the enemy's allies because this official skill has 識別.
   tacticalSkill('wiki-219',[companionsHpBelow(45)],{sort:'hpPct',maxDist:28}),
   selfSkill('wiki-220',[selfHpBelow(58)]),
   selfSkill('wiki-205',[selfAPBelow(35)]),
   // Self-buff once when no buff remains (e.g. before engaging, after expiration).
   selfSkill('wiki-179',[selfNoBuff()]),
   // Target finishing blows at the enemy with the smallest remaining HP ratio.
   tacticalSkill('wiki-085',[targetAtMostHp(32)],{sort:'hpPct',minDist:15,maxDist:25}),
   // When crowded, keep ranged spacing against the *nearest* enemy,
   // while attacking the most vulnerable opponent separately.
   tacticalSkill('wiki-118',[enemyClose(9)],{
    target:'enemies',sort:'hpPct',minDist:18,maxDist:25,
    splitMovement:true,moveTargetMode:'individual',moveSubject:'enemies',
    moveConditions:[enemyClose(9)],movePriority:'movement'
   }),
   // Reliable armor-piercing attack against heavily defended opponents.
   tacticalSkill('wiki-079',[enemyDefenseAtLeast(85)],{minDist:15,maxDist:28,sort:'main'}),
   // Interrupt a ready-to-act enemy with binding/buff removal when appropriate.
   tacticalSkill('wiki-118',[enemyAVAtLeast(90)],{minDist:14,maxDist:26,sort:'main'}),
   // Sure-hit area damage, followed by a precise single-target alternative.
   tacticalSkill('wiki-117',[enemiesAlive()],{minDist:16,maxDist:27,sort:'nearest'}),
   tacticalSkill('wiki-085',[enemiesAlive()],{minDist:16,maxDist:27,sort:'hpPct'}),
   fallback(),carry()
  ]
 });
}
