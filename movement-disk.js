// Movement is a continuous Euclidean disk, clipped to the square battlefield.
// Candidates approximate its curved boundary and include all exact intersections
// of the movement circle, target-distance circles and map edges. No axis-wise
// clamping of a preselected vector is allowed: that would discard legal movement.
const EPS=1e-6;
export const pointDistance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function inMovementDisk(origin,pos,capacity,half,eps=EPS){
 return Number.isFinite(pos?.x)&&Number.isFinite(pos?.y)&&
  Math.abs(pos.x)<=half+eps&&Math.abs(pos.y)<=half+eps&&
  pointDistance(origin,pos)<=capacity+eps;
}
function intersectCircles(a,ra,b,rb,add){
 const d=pointDistance(a,b);
 if(d<EPS||d>ra+rb+EPS||d<Math.abs(ra-rb)-EPS)return;
 const hAlong=(ra*ra-rb*rb+d*d)/(2*d);
 const height=Math.sqrt(Math.max(0,ra*ra-hAlong*hAlong));
 const x=a.x+(b.x-a.x)*hAlong/d,y=a.y+(b.y-a.y)*hAlong/d;
 const px=-(b.y-a.y)*height/d,py=(b.x-a.x)*height/d;
 add({x:x+px,y:y+py});add({x:x-px,y:y-py});
}
function ringEdgeCrossings(center,r,half,add){
 for(const v of [-half,half]){
  const dx=v-center.x;
  if(Math.abs(dx)<=r+EPS){const dy=Math.sqrt(Math.max(0,r*r-dx*dx));add({x:v,y:center.y+dy});add({x:v,y:center.y-dy});}
  const dy=v-center.y;
  if(Math.abs(dy)<=r+EPS){const dx=Math.sqrt(Math.max(0,r*r-dy*dy));add({x:center.x+dx,y:v});add({x:center.x-dx,y:v});}
 }
}
// Generate feasible extremes and meaningful points on target-distance rings.
// An arbitrary destination inside the disk is legal (inMovementDisk); these
// candidates are only used to choose among legal destinations for the AI.
export function movementDiskCandidates(origin,target,capacity,half,radii=[]){
 const out=[],seen=new Set();
 const add=p=>{
  if(!inMovementDisk(origin,p,capacity,half))return;
  const x=Math.max(-half,Math.min(half,p.x)),y=Math.max(-half,Math.min(half,p.y));
  const key=`${Math.round(x*10000)},${Math.round(y*10000)}`;
  if(!seen.has(key)){seen.add(key);out.push({x,y});}
 };
 add(origin);
 const d=pointDistance(origin,target);
 if(d>EPS){
  // Exact full-length moves directly toward and away from the target.
  const dx=(origin.x-target.x)/d,dy=(origin.y-target.y)/d;
  add({x:origin.x+capacity*dx,y:origin.y+capacity*dy});
  add({x:origin.x-capacity*dx,y:origin.y-capacity*dy});
 }
 for(const x of [-half,half])for(const y of [-half,half])add({x,y});
 const count=24;
 for(let i=0;i<count;i++){
  const theta=2*Math.PI*i/count;
  add({x:origin.x+capacity*Math.cos(theta),y:origin.y+capacity*Math.sin(theta)});
 }
 ringEdgeCrossings(origin,capacity,half,add);
 // Exact extremes on the square edges, and possible full-length edge points.
 for(const v of [-half,half]){
  const maxY=Math.sqrt(Math.max(0,capacity*capacity-(v-origin.x)**2));
  if(Math.abs(v-origin.x)<=capacity+EPS){
   const lo=Math.max(-half,origin.y-maxY),hi=Math.min(half,origin.y+maxY);
   for(const y of [lo,hi,(lo+hi)/2,target.y])add({x:v,y});
  }
  const maxX=Math.sqrt(Math.max(0,capacity*capacity-(v-origin.y)**2));
  if(Math.abs(v-origin.y)<=capacity+EPS){
   const lo=Math.max(-half,origin.x-maxX),hi=Math.min(half,origin.x+maxX);
   for(const x of [lo,hi,(lo+hi)/2,target.x])add({x,y:v});
  }
 }
 for(const radius of radii){
  if(!Number.isFinite(radius)||radius<0||radius>2*Math.SQRT2*half+EPS)continue;
  if(radius<EPS){add(target);continue;}
  intersectCircles(origin,capacity,target,radius,add);
  ringEdgeCrossings(target,radius,half,add);
  for(let i=0;i<count;i++){
   const theta=2*Math.PI*i/count;
   add({x:target.x+radius*Math.cos(theta),y:target.y+radius*Math.sin(theta)});
  }
 }
 return out;
}

export function selectDiskDestination(origin,target,capacity,half,{mode='fixed',minDist=0,maxDist=0,moveOnly=false,blocked=()=>false}={}){
 if(!Number.isFinite(capacity)||capacity<=EPS)return null;
 const initial=pointDistance(origin,target);
 const lo=Math.max(0,Number(minDist)||0),hi=Math.max(lo,Number(maxDist)||0);
 if(mode==='approach'){
  // The shortest move to one metre from the target: an exact solution in a
  // convex battlefield. Other bearings remain feasible via inMovementDisk.
  const desired=1,delta=Math.max(-capacity,Math.min(capacity,initial-desired));
  const ux=initial?(target.x-origin.x)/initial:1,uy=initial?(target.y-origin.y)/initial:0;
  const point={x:origin.x+ux*delta,y:origin.y+uy*delta};
  return pointDistance(origin,point)>EPS&&inMovementDisk(origin,point,capacity,half)&&!blocked(point)?point:null;
 }
 if(mode!=='away'&&!moveOnly&&initial>=lo-EPS&&initial<=hi+EPS)return null;
 const wide=mode==='fixed'&&hi>=2*half;
 const rings=mode==='away'?[]:[lo,hi,Math.max(lo,Math.min(hi,initial)),(lo+Math.min(hi,2*Math.SQRT2*half))/2];
 const all=movementDiskCandidates(origin,target,capacity,half,rings);
 let best=null,bestPrimary=-Infinity,bestSecondary=-Infinity;
 for(const pos of all){
  const traveled=pointDistance(origin,pos);
  if(traveled<=EPS||blocked(pos))continue;
  const d=pointDistance(pos,target);
  const gap=Math.max(lo-d,0,d-hi);
  // A retreat must not cut through the reference target merely to spend more
  // metres. Sideways positions remain available when the map edge blocks the
  // outward direction. Likewise, an approach must not head away from target.
  if(mode==='fixed'&&initial>EPS){
   const toward=(pos.x-origin.x)*(target.x-origin.x)+(pos.y-origin.y)*(target.y-origin.y);
   if(initial<lo-5&&toward>EPS)continue;
   if(initial>hi+5&&toward<-EPS)continue;
  }
  let primary,secondary;
  if(mode==='away'||wide){primary=d;secondary=traveled;}
  else {
   primary=-gap;
   // An exact requested distance is positioning, not an instruction to orbit:
   // preserve the shortest adjustment when currently outside that distance.
   // A distance BAND permits spending the full move to change bearings.
   const exactAdjustment=hi-lo<=EPS&&Math.max(lo-initial,0,initial-hi)>EPS;
   secondary=moveOnly&&!exactAdjustment?traveled:-traveled;
  }
  if(primary>bestPrimary+1e-5||(Math.abs(primary-bestPrimary)<=1e-5&&secondary>bestSecondary+1e-5)){
   best=pos;bestPrimary=primary;bestSecondary=secondary;
  }
 }
 // An 'approach' or 'fixed' AI must not move farther from the requested band.
 if(best&&mode!=='away'&&!wide){
  const initialGap=Math.max(lo-initial,0,initial-hi);
  const finalGap=Math.max(lo-pointDistance(best,target),0,pointDistance(best,target)-hi);
  if(finalGap>=initialGap-EPS&&initialGap>EPS)return null;
 }
 return best;
}
