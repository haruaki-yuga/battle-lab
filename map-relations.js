// 戦闘マップの描画補助。純粋関数なので戦闘結果と設定データは変更しない。
export const MAP_ZOOM_STEPS=[1,1.5,2,3,4];

export function directionBetween(dx,dy){
 const east=dx>0.05?'東':dx<-.05?'西':'';
 const north=dy>0.05?'北':dy<-.05?'南':'';
 return north+east||'同じ位置';
}

export function mapRelationPairs(units,focus='all'){
 const out=[];
 for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
  const a=units[i],b=units[j];
  if(focus!=='all'&&a.id!==focus&&b.id!==focus)continue;
  // 基準キャラを始点にすることで方角が常に基準→相手になる。
  const from=focus!=='all'&&b.id===focus?b:a;
  const to=from===a?b:a;
  const dx=Number(to.x)-Number(from.x),dy=Number(to.y)-Number(from.y);
  if(!Number.isFinite(dx)||!Number.isFinite(dy))continue;
  out.push({from,to,dx,dy,distance:Math.hypot(dx,dy),direction:directionBetween(dx,dy)});
 }
 return out;
}

export function mapViewport(width,height,scale,zoom=1,pan={x:0,y:0},mapSize=150){
 const z=Math.min(4,Math.max(1,Number(zoom)||1));
 const half=Math.max(1,Number(mapSize)||150)/2;
 const maxX=Math.max(0,half-(width/z-20)/(2*scale));
 const maxY=Math.max(0,half-(height/z-20)/(2*scale));
 const x=maxX===0?0:Math.max(-maxX,Math.min(maxX,Number(pan?.x)||0));
 const y=maxY===0?0:Math.max(-maxY,Math.min(maxY,Number(pan?.y)||0));
 return {x:(width-width/z)/2+x*scale,y:(height-height/z)/2-y*scale,width:width/z,height:height/z,pan:{x,y}};
}
