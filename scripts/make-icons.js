// 產生帶中文字的 App 圖示：白底、藍色行事曆、黑色「開發處休假表」。
// 環境無 canvas/convert/npm，於是直接解析系統字型 wqy-zenhei.ttc 的字形外框並自繪。
// 以 4 倍超取樣再降採樣做抗鋸齒。純 Node。
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/* ───────── PNG 編碼 ───────── */
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return(~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const body=Buffer.concat([Buffer.from(type,"ascii"),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,crc]);}
function encodePNG(W,H,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;const stride=W*4;const raw=Buffer.alloc((stride+1)*H);for(let y=0;y<H;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride);}return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);}

/* ───────── TrueType 解析 ───────── */
class Font {
  constructor(buf){ this.b=buf; this.parse(); }
  u16(o){return this.b.readUInt16BE(o);} i16(o){return this.b.readInt16BE(o);} u32(o){return this.b.readUInt32BE(o);} f2(o){return this.i16(o)/16384;}
  parse(){
    let off=0;
    if(this.b.toString("ascii",0,4)==="ttcf") off=this.u32(12); // 取集合中第一套字型
    const numTables=this.u16(off+4); this.t={}; let p=off+12;
    for(let i=0;i<numTables;i++){ this.t[this.b.toString("ascii",p,p+4)]={off:this.u32(p+8),len:this.u32(p+12)}; p+=16; }
    const h=this.t.head.off; this.upm=this.u16(h+18); this.locFmt=this.i16(h+50);
    this.numGlyphs=this.u16(this.t.maxp.off+4);
    this.parseCmap(); this.parseLoca();
  }
  parseLoca(){ const o=this.t.loca.off,n=this.numGlyphs+1; this.loca=new Array(n);
    if(this.locFmt===0){for(let i=0;i<n;i++)this.loca[i]=this.u16(o+i*2)*2;} else {for(let i=0;i<n;i++)this.loca[i]=this.u32(o+i*4);} }
  parseCmap(){ const o=this.t.cmap.off,num=this.u16(o+2); let best=null;
    for(let i=0;i<num;i++){ const pID=this.u16(o+4+i*8),eID=this.u16(o+6+i*8),so=this.u32(o+8+i*8),fmt=this.u16(o+so);
      const score=(pID===3&&eID===10)?5:(pID===3&&eID===1)?4:(pID===0)?3:1;
      if((fmt===4||fmt===12)&&(!best||score>best.score)) best={score,off:o+so,fmt}; }
    this.cmap=best; }
  gid(cp){ const c=this.cmap; if(!c)return 0; const o=c.off;
    if(c.fmt===4){ const segX2=this.u16(o+6),seg=segX2/2,endO=o+14,startO=endO+segX2+2,deltaO=startO+segX2,rangeO=deltaO+segX2;
      for(let i=0;i<seg;i++){ const end=this.u16(endO+i*2); if(cp<=end){ const start=this.u16(startO+i*2); if(cp<start)return 0;
        const delta=this.u16(deltaO+i*2),ro=this.u16(rangeO+i*2); if(ro===0)return(cp+delta)&0xffff;
        const gi=this.u16(rangeO+i*2+ro+(cp-start)*2); return gi===0?0:(gi+delta)&0xffff; } } return 0; }
    if(c.fmt===12){ const ng=this.u32(o+12); for(let i=0;i<ng;i++){ const g=o+16+i*12,sc=this.u32(g),ec=this.u32(g+4),sg=this.u32(g+8); if(cp>=sc&&cp<=ec)return sg+(cp-sc);} return 0; }
    return 0; }
  contours(gid,depth=0){ if(depth>6)return [];
    const s=this.t.glyf.off+this.loca[gid], e=this.t.glyf.off+this.loca[gid+1]; if(e<=s)return [];
    let p=s; const nc=this.i16(p); p+=2; p+=8;
    if(nc<0){ let out=[]; // 複合字形
      while(true){ const flags=this.u16(p),cg=this.u16(p+2); p+=4; let a1,a2;
        if(flags&1){a1=this.i16(p);a2=this.i16(p+2);p+=4;} else {a1=(this.b[p]<<24>>24);a2=(this.b[p+1]<<24>>24);p+=2;}
        let a=1,b=0,c=0,d=1;
        if(flags&8){a=d=this.f2(p);p+=2;} else if(flags&0x40){a=this.f2(p);d=this.f2(p+2);p+=4;}
        else if(flags&0x80){a=this.f2(p);b=this.f2(p+2);c=this.f2(p+4);d=this.f2(p+6);p+=8;}
        const dx=(flags&2)?a1:0, dy=(flags&2)?a2:0;
        for(const ct of this.contours(cg,depth+1)) out.push(ct.map(q=>({x:a*q.x+c*q.y+dx,y:b*q.x+d*q.y+dy,on:q.on})));
        if(!(flags&0x20))break; }
      return out; }
    const endPts=[]; for(let i=0;i<nc;i++){endPts.push(this.u16(p));p+=2;}
    const npts=endPts[nc-1]+1; const il=this.u16(p); p+=2+il;
    const flags=new Array(npts);
    for(let i=0;i<npts;){ const f=this.b[p++]; flags[i++]=f; if(f&8){let r=this.b[p++]; while(r-->0&&i<npts)flags[i++]=f;} }
    const xs=new Array(npts),ys=new Array(npts); let x=0;
    for(let i=0;i<npts;i++){const f=flags[i]; if(f&2){const dx=this.b[p++];x+=(f&0x10)?dx:-dx;} else if(!(f&0x10)){x+=this.i16(p);p+=2;} xs[i]=x;}
    let y=0;
    for(let i=0;i<npts;i++){const f=flags[i]; if(f&4){const dy=this.b[p++];y+=(f&0x20)?dy:-dy;} else if(!(f&0x20)){y+=this.i16(p);p+=2;} ys[i]=y;}
    const out=[]; let st=0;
    for(let ci=0;ci<nc;ci++){ const en=endPts[ci],pts=[]; for(let i=st;i<=en;i++)pts.push({x:xs[i],y:ys[i],on:!!(flags[i]&1)}); out.push(pts); st=en+1; }
    return out; }
}
// 外框二次貝茲展平成多邊形
function flatten(contour,steps=10){ if(!contour.length)return [];
  const pts=[]; for(let i=0;i<contour.length;i++){ const cur=contour[i],nxt=contour[(i+1)%contour.length]; pts.push(cur);
    if(!cur.on&&!nxt.on)pts.push({x:(cur.x+nxt.x)/2,y:(cur.y+nxt.y)/2,on:true}); }
  let s=pts.findIndex(p=>p.on); if(s<0)return [];
  const seq=pts.slice(s).concat(pts.slice(0,s)); seq.push(seq[0]);
  const poly=[[seq[0].x,seq[0].y]]; let i=1;
  while(i<seq.length){ const p=seq[i];
    if(p.on){ poly.push([p.x,p.y]); i++; }
    else { const ctrl=p,end=seq[i+1],x0=poly[poly.length-1][0],y0=poly[poly.length-1][1];
      for(let t=1;t<=steps;t++){const u=t/steps,mt=1-u; poly.push([mt*mt*x0+2*mt*u*ctrl.x+u*u*end.x, mt*mt*y0+2*mt*u*ctrl.y+u*u*end.y]);} i+=2; } }
  return poly; }

/* ───────── 畫布 ───────── */
function newBuf(S){ const buf=Buffer.alloc(S*S*4); return buf; }
function fillRGB(buf,S,col){ for(let i=0;i<S*S;i++){buf[i*4]=col[0];buf[i*4+1]=col[1];buf[i*4+2]=col[2];buf[i*4+3]=255;} }
function setPx(buf,S,x,y,col){ x|=0;y|=0; if(x<0||y<0||x>=S||y>=S)return; const i=(y*S+x)*4; buf[i]=col[0];buf[i+1]=col[1];buf[i+2]=col[2];buf[i+3]=255; }
function rrect(buf,S,x0,y0,x1,y1,rad,col){ for(let y=Math.floor(y0);y<Math.ceil(y1);y++)for(let x=Math.floor(x0);x<Math.ceil(x1);x++){
  let dx=0,dy=0; if(x<x0+rad)dx=x0+rad-x; else if(x>x1-rad)dx=x-(x1-rad); if(y<y0+rad)dy=y0+rad-y; else if(y>y1-rad)dy=y-(y1-rad);
  if(Math.sqrt(dx*dx+dy*dy)>rad)continue; setPx(buf,S,x,y,col); } }
function rstroke(buf,S,x0,y0,x1,y1,rad,w,col){ for(let y=Math.floor(y0)-1;y<Math.ceil(y1)+1;y++)for(let x=Math.floor(x0)-1;x<Math.ceil(x1)+1;x++){
  let dx=0,dy=0; if(x<x0+rad)dx=x0+rad-x; else if(x>x1-rad)dx=x-(x1-rad); if(y<y0+rad)dy=y0+rad-y; else if(y>y1-rad)dy=y-(y1-rad);
  const inR=(x<x0+rad||x>x1-rad)&&(y<y0+rad||y>y1-rad); const d=Math.sqrt(dx*dx+dy*dy);
  const edge=inR?Math.abs(d-rad):Math.min(Math.abs(x-x0),Math.abs(x-x1),Math.abs(y-y0),Math.abs(y-y1));
  const inside=x>=x0&&x<=x1&&y>=y0&&y<=y1&&(!inR||d<=rad); if(inside&&edge<=w)setPx(buf,S,x,y,col); } }

// 以非零環繞規則填多邊形（像素座標）
function fillPolys(buf,S,polys,col){ let minY=Infinity,maxY=-Infinity;
  for(const p of polys)for(const v of p){if(v[1]<minY)minY=v[1];if(v[1]>maxY)maxY=v[1];}
  for(let py=Math.max(0,Math.floor(minY));py<=Math.min(S-1,Math.ceil(maxY));py++){ const yc=py+0.5; const xs=[];
    for(const poly of polys)for(let i=0;i<poly.length;i++){ const a=poly[i],b=poly[(i+1)%poly.length]; if(a[1]===b[1])continue;
      if((yc>=a[1]&&yc<b[1])||(yc>=b[1]&&yc<a[1])){ xs.push({x:a[0]+(yc-a[1])/(b[1]-a[1])*(b[0]-a[0]),d:b[1]>a[1]?1:-1}); } }
    xs.sort((p,q)=>p.x-q.x); let w=0;
    for(let k=0;k<xs.length-1;k++){ w+=xs[k].d; if(w!==0){ const xa=Math.round(xs[k].x),xb=Math.round(xs[k+1].x); for(let px=xa;px<xb;px++)setPx(buf,S,px,py,col); } } } }

// 在 (cellLeft, baseline) 的 cell 內畫一個字（水平置中、對齊基線）
function drawChar(buf,S,font,ch,cellLeft,cell,baseline,col){
  const gid=font.gid(ch.codePointAt(0)); if(!gid)return;
  const scale=cell/font.upm;
  const cons=font.contours(gid).map(c=>flatten(c)).filter(p=>p.length>=2);
  let minX=Infinity,maxX=-Infinity; for(const p of cons)for(const v of p){if(v[0]<minX)minX=v[0];if(v[0]>maxX)maxX=v[0];}
  if(!isFinite(minX))return;
  const gw=(maxX-minX)*scale; const offX=cellLeft+(cell-gw)/2-minX*scale;
  const polys=cons.map(p=>p.map(v=>[offX+v[0]*scale, baseline-v[1]*scale]));
  fillPolys(buf,S,polys,col);
}

/* ───────── 組圖 ───────── */
const BLUE=[37,99,235], WHITE=[255,255,255], BLACK=[17,24,39], PINK=[236,72,153], GRAY=[203,213,225], BG=[255,255,255];
const FONT=new Font(fs.readFileSync("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"));

function drawIcon(S){
  const buf=newBuf(S); fillRGB(buf,S,BG);
  // 上方：藍色小行事曆
  const cw=S*0.34, ch=cw*0.84, cx0=(S-cw)/2, cy0=S*0.085, cx1=cx0+cw, cy1=cy0+ch, rad=cw*0.14, hH=ch*0.28;
  rrect(buf,S,cx0,cy0,cx1,cy1,rad,WHITE); rstroke(buf,S,cx0,cy0,cx1,cy1,rad,Math.max(2,S*0.008),BLUE);
  rrect(buf,S,cx0,cy0,cx1,cy0+hH,rad,BLUE); rrect(buf,S,cx0,cy0+hH-rad,cx1,cy0+hH,0,BLUE);
  const padX=cw*0.14, gw=cw-2*padX, cell=gw/3.8, gap=cell*0.4, gx0=cx0+padX;
  const bTop=cy0+hH+ch*0.1, bBot=cy1-ch*0.12, gy0=bTop+((bBot-bTop)-(2*cell+gap))/2;
  for(let r=0;r<2;r++)for(let c=0;c<3;c++){ const x=gx0+c*(cell+gap),y=gy0+r*(cell+gap); rrect(buf,S,x,y,x+cell,y+cell,cell*0.28,(r===1&&c===2)?PINK:GRAY); }
  // 下方：黑色「開發處休假表」兩行（開發處 / 休假表）
  const rows=["開發處","休假表"]; const tcell=S*0.235, rowW=tcell*3, startX=(S-rowW)/2;
  const base=[S*0.66, S*0.90];
  rows.forEach((row,ri)=>{ for(let i=0;i<row.length;i++) drawChar(buf,S,FONT,row[i],startX+i*tcell,tcell,base[ri],BLACK); });
  return buf;
}
// 4 倍超取樣降採樣（box）
function downsample(src,SS,factor){ const T=SS/factor,out=Buffer.alloc(T*T*4),n=factor*factor;
  for(let y=0;y<T;y++)for(let x=0;x<T;x++){ let r=0,g=0,b=0;
    for(let dy=0;dy<factor;dy++)for(let dx=0;dx<factor;dx++){const i=((y*factor+dy)*SS+(x*factor+dx))*4;r+=src[i];g+=src[i+1];b+=src[i+2];}
    const o=(y*T+x)*4; out[o]=Math.round(r/n);out[o+1]=Math.round(g/n);out[o+2]=Math.round(b/n);out[o+3]=255; }
  return out; }

const outDir=path.join(__dirname,"..","public");
for(const T of [180,192,512]){ const F=4, SS=T*F; const big=drawIcon(SS); const small=downsample(big,SS,F);
  const file=path.join(outDir,`icon-${T}.png`); fs.writeFileSync(file,encodePNG(T,T,small)); console.log("wrote",file); }
