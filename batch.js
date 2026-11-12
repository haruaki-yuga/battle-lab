import {Battle} from './engine.js';
import {runSeed} from './run-settings.js';
export function runBatch(config,n,onProgress=()=>{}){
 if(!Number.isInteger(n)||n<1||n>500)throw Error('試行回数は1〜500です。');
 const seed=runSeed(config),result={seed,A:0,B:0,draw:0,n:0,meanTurns:0};let turns=0;
 for(let i=0;i<n;i++){
  const r=new Battle(config,`${seed}:#${i+1}`,{quiet:true}).run();
  result[r.winner||'draw']++;result.n++;turns+=r.turns;
  if(i%5===0)onProgress(i+1);
 }
 result.meanTurns=turns/n;return result;
}
