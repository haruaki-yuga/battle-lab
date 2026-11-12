// Partial reconstruction from the user-provided saved HTML for arena battle 398394.
// Only HP, AP, speed, starting positions and the recorded opening moves are grounded.
// All other stats, Shau's remaining tactics and Udo's exact skill definition are
// PLACEHOLDERS and MUST NOT be confused with imported character-sheet values.
import {sampleConfig,freshUnit,freshRule,freshSkill,freshCondition} from './model.js';
export const arena398394Reference=Object.freeze({
 source:'https://rev2.reversion.jp/arena/battle/398394',
 turn:1,udo:{hp:7250,ap:5805,speed:209,start:[-10,0],move:[27,0],movement:37},
 shau:{hp:6320,ap:6400,speed:241,start:[10,0],move:[28,0],movement:18},
 dice:{udo:[73,1],shau:[42,11]},
 udoActionValues:[283,233,183,133,93,46],shauActionValues:[294,254,127],
 observedDistanceAfter:1
});
const selfMetric=(metric,min,max)=>({...freshCondition(),subject:'self',metric,min,max});
export function createArena398394FirstTurnConfig(){
 const config=sampleConfig();
 config.name='公式398394 第1ターン位置・行動値の部分再現（能力値・AIは未確認部分あり）';
 config.settings.combatMode='official';config.settings.turns=1;config.settings.seedMode='fixed';config.settings.seed='398394-partial';
 // Side affects its own action only. Do not grant the side effect as a lasting buff.
 const butterfly=freshSkill({id:'arena398394-butterfly-placeholder',name:'胡蝶落とし',kind:'buff',scope:'self',range:'touch',cost:50,ap:750,effects:{side:1},grantedEffects:{},modifiers:{maxHp:500,defense:10,resist:10},mainPct:0,subPct:0,power:0,note:'公式ログの第1ターンを再現する仮定義。元スキルの完全な性能ではありません。'});
 config.skills.push(butterfly);
 const udo=freshUnit({id:'arena398394-udo',name:'ウード',team:'B',x:-10,y:0,maxHp:7250,maxAp:5805,speed:209,mobility:4,normalRange:'touch',skills:[butterfly.id],rules:[
  freshRule({action:'skill',skillId:butterfly.id,target:'self',autoMove:false,conditions:[selfMetric('buffCount',0,0)]}),
  freshRule({action:'focusDefense',target:'self',autoMove:false,conditions:[]}),
  freshRule({action:'attack',target:'enemies',autoMove:true,moveMode:'approach',minDist:1,maxDist:1,conditions:[]})
 ]});
 const shau=freshUnit({id:'arena398394-shau',name:'シャウ',team:'A',x:10,y:0,maxHp:6320,maxAp:6400,speed:241,mobility:4,skills:[],rules:[
  freshRule({action:'move',autoMove:true,target:'enemies',moveMode:'fixed',minDist:38,maxDist:38,conditions:[{...freshCondition(),subject:'enemies',metric:'distance',min:0,max:35}]}),
  freshRule({action:'carry',target:'self',autoMove:false,conditions:[]})
 ]});
 config.units=[udo,shau];
 return config;
}
