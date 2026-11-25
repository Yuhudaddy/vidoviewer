import {bulgeArc} from './core/geom.js';
const ID=[1,0,0,1,0,0];
const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const point=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
function bounds(e){if(e.bounds)return e.bounds;if(e.type==='line')return {min:{x:Math.min(e.p1.x,e.p2.x),y:Math.min(e.p1.y,e.p2.y)},max:{x:Math.max(e.p1.x,e.p2.x),y:Math.max(e.p1.y,e.p2.y)}};if(e.c&&Number.isFinite(e.r))return {min:{x:e.c.x-e.r,y:e.c.y-e.r},max:{x:e.c.x+e.r,y:e.c.y+e.r}};return null}
function visible(b,m,v){if(!b)return true;const ps=[b.min,{x:b.min.x,y:b.max.y},b.max,{x:b.max.x,y:b.min.y}].map(p=>point(m,p));return Math.max(...ps.map(p=>p.x))>=v.min.x&&Math.min(...ps.map(p=>p.x))<=v.max.x&&Math.max(...ps.map(p=>p.y))>=v.min.y&&Math.min(...ps.map(p=>p.y))<=v.max.y}
export class Renderer{
 // insets:面板占掉的邊距(CSS px),fit 只用剩下的可視範圍。pill:圖上數字膠囊的元素。
 constructor(canvas,{onBudget,pill}={}){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onBudget=onBudget;this.pill=pill;this.scale=1;this.cx=0;this.cy=0;this.scene=null;this.fitted=false;this.insets={top:0,right:0,bottom:0,left:0};this.clearOverlay();this.resize();new ResizeObserver(()=>{this.resize();if(this.fitted)this.fit();else this.draw()}).observe(canvas)}
 // 圖上由 App 畫的東西:已放置的點、鎖點預覽、未確定的量測線終點、面積外框、膠囊文字。
 clearOverlay(){this.points=[];this.preview=null;this.rubber=null;this.outline=null;this.label=null;this.savedMarks=[]}
 resize(){const r=this.canvas.getBoundingClientRect();this.w=r.width;this.h=r.height;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr)}
 setScene(scene){this.scene=scene;this.clearOverlay();this.fit()}
 fit(){if(!this.scene?.extents||!this.w||!this.h)return;const {min,max}=this.scene.extents,i=this.insets,aw=Math.max(40,this.w-i.left-i.right),ah=Math.max(40,this.h-i.top-i.bottom);this.scale=Math.max(1e-9,Math.min(aw*.92/Math.max(max.x-min.x,1e-9),ah*.92/Math.max(max.y-min.y,1e-9)));this.cx=(min.x+max.x)/2-(i.left+aw/2-this.w/2)/this.scale;this.cy=(min.y+max.y)/2+(i.top+ah/2-this.h/2)/this.scale;this.fitted=true;this.draw()}
 screen(p){return {x:this.w/2+(p.x-this.cx)*this.scale,y:this.h/2-(p.y-this.cy)*this.scale}}
 world(x,y){return {x:this.cx+(x-this.w/2)/this.scale,y:this.cy-(y-this.h/2)/this.scale}}
 zoom(f,x=this.w/2,y=this.h/2){const before=this.world(x,y);this.scale=Math.max(1e-9,Math.min(1e9,this.scale*f));const after=this.world(x,y);this.cx+=before.x-after.x;this.cy+=before.y-after.y;this.fitted=false;this.draw()}
 pan(dx,dy){this.cx-=dx/this.scale;this.cy+=dy/this.scale;this.fitted=false;this.draw()}
 walk(fn,deadline=Infinity){if(!this.scene)return false;if(this.scene.model)return this.walkScene(fn,deadline);const protos=new Map((this.scene.protos||[]).map(p=>[p.id,p]));let stopped=false,count=0;const visit=(group,m,depth,seen)=>{if(depth>24)return;for(const e of group.entities||[]){if((++count&127)===0&&performance.now()>deadline){stopped=true;return}if(visible(bounds(e),m,this.view))fn(e,m)}for(const i of group.inserts||[]){const p=protos.get(i.proto);if(!p||seen.has(i.proto))continue;const next=mul(m,i.matrix||ID);if(!visible(p.bounds,next,this.view))continue;visit(p,next,depth+1,new Set([...seen,i.proto]));if(stopped)return}};visit(this.scene,ID,0,new Set());if(!stopped)for(const d of this.scene.dimensions||[]){const p=protos.get(d.proto);if(p)visit(p,ID,1,new Set([d.proto]));if(stopped)break}return stopped}
 walkScene(fn,deadline){
  const scene=this.scene;let count=0,stopped=false;const layers=scene.layers||[];
  const emit=(e,m,layer,color,inheritLayer,inheritColor)=>{if((++count&127)===0&&performance.now()>deadline){stopped=true;return}let li=layer;if(layers[li]?.name==='0'&&inheritLayer!=null)li=inheritLayer;const l=layers[li];if(l?.visible===false)return;let rgb=color===-2?inheritColor:color;if(rgb==null||rgb<0)rgb=l?.color??0xffffff;e.color='#'+(rgb>>>0).toString(16).padStart(6,'0');if(visible(bounds(e),m,this.view))fn(e,m)};
  const visit=(sp,m,il=null,ic=null,seen=new Set(),depth=0)=>{if(!sp||stopped||depth>24)return;const a=(attr,i)=>[attr?.[i*2]??-1,attr?.[i*2+1]??-1];
   for(let i=0;i<sp.lines.length/4&&!stopped;i++){let j=i*4;emit({type:'line',p1:{x:sp.lines[j],y:sp.lines[j+1]},p2:{x:sp.lines[j+2],y:sp.lines[j+3]}},m,...a(sp.lineAttr,i),il,ic)}
   for(let i=0;i<sp.arcs.length/5&&!stopped;i++){let j=i*5;emit({type:'arc',c:{x:sp.arcs[j],y:sp.arcs[j+1]},r:sp.arcs[j+2],a0:sp.arcs[j+3],a1:sp.arcs[j+4]},m,...a(sp.arcAttr,i),il,ic)}
   for(let i=0;i<sp.circles.length/3&&!stopped;i++){let j=i*3;emit({type:'circle',c:{x:sp.circles[j],y:sp.circles[j+1]},r:sp.circles[j+2]},m,...a(sp.circleAttr,i),il,ic)}
   const p=sp.polys;for(let i=0;i<p.closed.length&&!stopped;i++){let pts=[];for(let j=p.offsets[i];j<p.offsets[i+1];j++)pts.push({x:p.pts[j*2],y:p.pts[j*2+1],bulge:p.bulges[j]});emit({type:'polyline',points:pts,closed:!!p.closed[i]},m,...a(p.attr,i),il,ic)}
   for(let i=0;i<sp.solids.length/8&&!stopped;i++){let pts=[];for(let j=0;j<4;j++)pts.push({x:sp.solids[i*8+j*2],y:sp.solids[i*8+j*2+1]});emit({type:'solid',points:pts},m,...a(sp.solidAttr,i),il,ic)}
   for(let i=0;i<sp.points.length/2&&!stopped;i++)emit({type:'point',p:{x:sp.points[i*2],y:sp.points[i*2+1]}},m,...a(sp.pointAttr,i),il,ic);
   for(const t of sp.texts){if(stopped)break;emit({type:'text',p:{x:t.x,y:t.y},height:t.h,rotation:t.rot,text:t.str},m,t.layer,t.color,il,ic)}
   for(const h of sp.hatches){if(stopped)break;for(const loop of h.loops){let pts=[];for(let j=0;j<loop.length;j+=2)pts.push({x:loop[j],y:loop[j+1]});emit({type:h.solid?'solid':'polyline',points:pts,closed:true},m,h.layer,h.color,il,ic)}}
   const ins=sp.inserts;for(let i=0;i<ins.proto.length&&!stopped;i++){if((++count&127)===0&&performance.now()>deadline){stopped=true;break}let pid=ins.proto[i];if(seen.has(pid))continue;let child=scene.protos[pid];if(!child)continue;let n=mul(m,Array.from(ins.m.subarray(i*6,i*6+6)));let bb=child.bbox;if(bb&&!visible({min:{x:bb[0],y:bb[1]},max:{x:bb[2],y:bb[3]}},n,this.view))continue;let [layer,color]=a(ins.attr,i);if(layers[layer]?.name==='0'&&il!=null)layer=il;if(layers[layer]?.visible===false)continue;if(color===-2)color=ic;if(color==null||color<0)color=layers[layer]?.color??0xffffff;visit(child,n,layer,color,new Set([...seen,pid]),depth+1)}
  };
  visit(scene.model,ID);for(const dim of scene.dimensions||[]){if(stopped)break;const sp=scene.protos[dim.proto],bb=sp?.bbox;if(bb&&!visible({min:{x:bb[0],y:bb[1]},max:{x:bb[2],y:bb[3]}},ID,this.view))continue;visit(sp,ID)}return stopped;
 }
 draw(){
  const c=this.ctx,d=this.dpr,css=getComputedStyle(document.documentElement),paper=css.getPropertyValue('--canvas').trim()||'#212830';
  c.setTransform(d,0,0,d,0,0);c.setLineDash([]);c.fillStyle=paper;c.fillRect(0,0,this.w,this.h);this.view={min:this.world(0,this.h),max:this.world(this.w,0)};
  if(!this.scene){if(this.pill)this.pill.hidden=true;return}
  const limited=this.walk((e,m)=>this.entity(c,e,m),performance.now()+7);this.onBudget?.(limited);
  c.setTransform(d,0,0,d,0,0);c.setLineDash([]);this.overlay(c,css,paper);
 }
 // 只畫圖面本身的小圖:沒有量測覆疊、工具與檔名。借用同一套 walk/entity,畫完還原視圖。
 thumbnail(width,height,budgetMs=80){
  if(!this.scene?.extents)return null;
  const out=document.createElement('canvas');out.width=width;out.height=height;
  const keep={ctx:this.ctx,w:this.w,h:this.h,dpr:this.dpr,scale:this.scale,cx:this.cx,cy:this.cy,view:this.view};
  try{
   const {min,max}=this.scene.extents,c=out.getContext('2d');
   Object.assign(this,{ctx:c,w:width,h:height,dpr:1,cx:(min.x+max.x)/2,cy:(min.y+max.y)/2,scale:Math.max(1e-9,Math.min(width*.9/Math.max(max.x-min.x,1e-9),height*.9/Math.max(max.y-min.y,1e-9)))});
   c.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()||'#212830';c.fillRect(0,0,width,height);
   this.view={min:this.world(0,height),max:this.world(width,0)};
   this.walk((e,m)=>this.entity(c,e,m),performance.now()+budgetMs);
  }finally{Object.assign(this,keep)}
  return out;
 }
 // 冰藍只用在這裡:量測線、掣點、鎖點標記、面積外框。數值讀設計變數,單位 CSS px。
 overlay(c,css,paper){
  const num=(k,v)=>{const n=parseFloat(css.getPropertyValue(k));return Number.isFinite(n)?n:v},accent=css.getPropertyValue('--accent').trim()||'#4CD7F6',soft=css.getPropertyValue('--accent-soft').trim()||'rgba(76,215,246,.14)';
  const lineW=num('--measure-w',1.25),casingW=num('--measure-casing-w',3.25),arrow=num('--measure-arrow',10),grip=num('--grip',7),snap=num('--snap',14),snapW=num('--snap-w',1.75),dash=(css.getPropertyValue('--measure-dash').trim()||'6 4').split(/\s+/).map(Number);
  const cased=(build,width=lineW)=>{c.beginPath();build();c.strokeStyle=paper;c.lineWidth=width+casingW-lineW;c.stroke();c.strokeStyle=accent;c.lineWidth=width;c.stroke()};
  // 已儲存的標記獨立於目前量測；編號最後畫，避免被量測線遮住。
  const markBadges=[];
  for(const mark of this.savedMarks||[]){
    const m=mark.measurement; if(!m)continue;let anchor=null;
    if(m.kind==='distance'&&m.points?.length===2){const [a,b]=m.points.map(p=>this.screen(p));cased(()=>{c.moveTo(a.x,a.y);c.lineTo(b.x,b.y)});anchor={x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
    else {const outline=m.kind==='area'?m.pick?.outline:m.outline;if(!outline?.length)continue;c.beginPath();this.tracePrims(c,outline);c.fillStyle=soft;c.fill('evenodd');cased(()=>this.tracePrims(c,outline));const a=mark.anchor;if(a)anchor=this.screen(a);}
    if(anchor)markBadges.push({anchor,number:mark.number});
  }
  if(this.outline?.length){c.beginPath();this.tracePrims(c,this.outline);c.fillStyle=soft;c.fill('evenodd');cased(()=>this.tracePrims(c,this.outline))}
  const pts=this.points.map(p=>this.screen(p));
  if(this.polygon&&pts.length>1){cased(()=>{c.moveTo(pts[0].x,pts[0].y);for(const p of pts.slice(1))c.lineTo(p.x,p.y)})}
  else if(pts.length===2){const [a,b]=pts;cased(()=>{c.moveTo(a.x,a.y);c.lineTo(b.x,b.y)});const angle=Math.atan2(b.y-a.y,b.x-a.x),half=Math.atan(1/6);c.fillStyle=accent;for(const [v,dir] of [[a,angle],[b,angle+Math.PI]]){c.beginPath();c.moveTo(v.x,v.y);c.lineTo(v.x+arrow*Math.cos(dir+half),v.y+arrow*Math.sin(dir+half));c.lineTo(v.x+arrow*Math.cos(dir-half),v.y+arrow*Math.sin(dir-half));c.closePath();c.fill()}}
  else if(pts.length===1&&this.rubber){const a=pts[0],b=this.screen(this.rubber);c.setLineDash(dash);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=accent;c.lineWidth=lineW;c.stroke();c.setLineDash([])}
  for(const a of pts){c.fillStyle=accent;c.strokeStyle=paper;c.lineWidth=1;c.beginPath();c.rect(a.x-grip/2,a.y-grip/2,grip,grip);c.fill();c.stroke()}
  for(const {anchor,number} of markBadges){c.beginPath();c.arc(anchor.x,anchor.y,10,0,Math.PI*2);c.fillStyle=accent;c.fill();c.fillStyle=paper;c.font='bold 11px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(number),anchor.x,anchor.y);}
  if(this.preview?.type){const a=this.screen(this.preview.point),r=snap/2,t=this.preview.type;cased(()=>{if(t==='midpoint'){c.moveTo(a.x,a.y-r);c.lineTo(a.x-r,a.y+r);c.lineTo(a.x+r,a.y+r);c.closePath()}else if(t==='center')c.arc(a.x,a.y,r,0,Math.PI*2);else if(t==='intersection'){c.moveTo(a.x-r,a.y-r);c.lineTo(a.x+r,a.y+r);c.moveTo(a.x+r,a.y-r);c.lineTo(a.x-r,a.y+r)}else c.rect(a.x-r,a.y-r,snap,snap)},snapW)}
  if(this.pill){this.pill.hidden=!this.label;if(this.label){const a=this.screen(this.label.at);this.pill.textContent=this.label.text;let x=Math.max(60,Math.min(this.w-60,a.x)),y=Math.max(20,Math.min(this.h-20,a.y+(this.label.dy||0)));
    // 膠囊不可被面板蓋住:碰到橫向的面板(讀數卡)往上讓,碰到直向的(縮放鈕)往左讓
    const pw=this.pill.offsetWidth/2+8,ph=this.pill.offsetHeight/2+8,avoid=this.avoid?.()||[];
    const intersects=(px,py,r)=>px+pw>r.left&&px-pw<r.right&&py+ph>r.top&&py-ph<r.bottom;
    if(avoid.some(r=>intersects(x,y,r))){
      const xs=[x,pw,this.w-pw,...avoid.flatMap(r=>[r.left-pw,r.right+pw])],ys=[y,ph,this.h-ph,...avoid.flatMap(r=>[r.top-ph,r.bottom+ph])];
      const candidates=xs.flatMap(cx=>ys.map(cy=>[cx,cy])).filter(([cx,cy])=>cx-pw>=0&&cx+pw<=this.w&&cy-ph>=0&&cy+ph<=this.h&&!avoid.some(r=>intersects(cx,cy,r)));
      if(candidates.length){candidates.sort((a,b)=>Math.hypot(a[0]-x,a[1]-y)-Math.hypot(b[0]-x,b[1]-y));[x,y]=candidates[0];}
    }
    this.pill.style.setProperty('--vv-x',`${x}px`);this.pill.style.setProperty('--vv-y',`${y}px`)}}
 }
 // 世界座標的基本形(core 的 line/arc/circle)畫成螢幕路徑;相連的線段接成同一條子路徑。
 tracePrims(c,prims){let last=null;const near=(p,q)=>p&&Math.hypot(p.x-q.x,p.y-q.y)<.01,at=(s,a)=>({x:s.c.x+s.r*Math.cos(a),y:s.c.y+s.r*Math.sin(a)});
  for(const s of prims){if(s.type==='circle'){const o=this.screen(s.c);c.moveTo(o.x+s.r*this.scale,o.y);c.arc(o.x,o.y,s.r*this.scale,0,Math.PI*2);last=null;continue}
   let from,to,reversed=false;if(s.type==='line'){from=s.p1;to=s.p2}else{from=at(s,s.a0);to=at(s,s.a1);if(s.p1&&Math.hypot(s.p1.x-to.x,s.p1.y-to.y)<Math.hypot(s.p1.x-from.x,s.p1.y-from.y)){reversed=true;[from,to]=[to,from]}}
   const a=this.screen(from),b=this.screen(to);if(!near(last,a))c.moveTo(a.x,a.y);
   if(s.type==='line')c.lineTo(b.x,b.y);else{const o=this.screen(s.c);if(reversed)c.arc(o.x,o.y,s.r*this.scale,-s.a1,-s.a0,false);else c.arc(o.x,o.y,s.r*this.scale,-s.a0,-s.a1,true)}
   last=b}}
 entity(c,e,m){const d=this.dpr,s=this.scale;c.setTransform(d*s*m[0],-d*s*m[1],d*s*m[2],-d*s*m[3],d*(this.w/2+(m[4]-this.cx)*s),d*(this.h/2-(m[5]-this.cy)*s));const ms=Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]),1e-9);c.strokeStyle=e.color||'#cfdae0';c.fillStyle=e.color||'#cfdae0';c.lineWidth=e.width>0?e.width:1/(this.dpr*s*ms);c.setLineDash(e.dash||[]);c.beginPath();if(e.type==='line'){c.moveTo(e.p1.x,e.p1.y);c.lineTo(e.p2.x,e.p2.y);c.stroke()}else if(e.type==='circle'||e.type==='arc'){c.arc(e.c.x,e.c.y,e.r,e.a0||0,e.type==='circle'?Math.PI*2:e.a1,!!e.clockwise);c.stroke()}else if(e.type==='polyline'){if(!e.points?.length)return;c.moveTo(e.points[0].x,e.points[0].y);for(let i=0;i<e.points.length-(e.closed?0:1);i++){const p=e.points[i],q=e.points[(i+1)%e.points.length],arc=p.bulge?bulgeArc(p,q,p.bulge):null;if(!arc)c.lineTo(q.x,q.y);else if(arc.ccw)c.arc(arc.center.x,arc.center.y,arc.r,arc.start,arc.end,false);else c.arc(arc.center.x,arc.center.y,arc.r,arc.end,arc.start,true)}if(e.closed)c.closePath();c.stroke()}else if(e.type==='point'){c.arc(e.p.x,e.p.y,2/(s*ms),0,Math.PI*2);c.fill()}else if(e.type==='text'){c.save();c.translate(e.p.x,e.p.y);c.rotate(e.rotation||0);c.scale(1,-1);c.font=`${e.height||10}px sans-serif`;for(const [i,line] of (e.text||'').split('\n').entries())c.fillText(line,0,i*(e.height||10)*1.25);c.restore()}else if(e.type==='solid'&&e.points?.length){c.moveTo(e.points[0].x,e.points[0].y);for(const p of e.points.slice(1))c.lineTo(p.x,p.y);c.closePath();c.fill()}}
}
