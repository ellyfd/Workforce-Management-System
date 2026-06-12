// 由主人提供的正式 Logo（assets/app-icon-master.png）產生 icon-180/192/512.png。
// 原圖四周留白過多 → 自動偵測內容範圍、放大裁切，讓圖案填滿方格（保留小安全邊距，
// 避免底部文字被 iOS 圓角切掉）。環境無 convert/canvas/npm，純 Node 自寫解碼/縮放/編碼。
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/* ── PNG 編碼（RGBA） ── */
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return(~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const body=Buffer.concat([Buffer.from(type,"ascii"),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,crc]);}
function encodePNG(W,H,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;const stride=W*4;const raw=Buffer.alloc((stride+1)*H);for(let y=0;y<H;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride);}return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);}

/* ── PNG 解碼（colortype 2=RGB / 6=RGBA, 8-bit, 非交錯） ── */
function decodePNG(buf){
  if(buf.readUInt32BE(0)!==0x89504e47) throw new Error("not png");
  const W=buf.readUInt32BE(16),H=buf.readUInt32BE(20),bd=buf[24],ct=buf[25],il=buf[28];
  if(bd!==8||il!==0||(ct!==2&&ct!==6)) throw new Error("unsupported png");
  const ch=ct===6?4:3; let p=33,idat=[];
  while(p<buf.length){const len=buf.readUInt32BE(p),t=buf.toString("ascii",p+4,p+8);if(t==="IDAT")idat.push(buf.slice(p+8,p+8+len));if(t==="IEND")break;p+=12+len;}
  const raw=zlib.inflateSync(Buffer.concat(idat));const stride=W*ch,out=Buffer.alloc(stride*H);let rp=0;
  const paeth=(a,b,c)=>{const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<H;y++){const f=raw[rp++];const ro=y*stride,po=(y-1)*stride;
    for(let x=0;x<stride;x++){const v=raw[rp++];const a=x>=ch?out[ro+x-ch]:0,b=y>0?out[po+x]:0,c=(x>=ch&&y>0)?out[po+x-ch]:0;
      let r;switch(f){case 0:r=v;break;case 1:r=v+a;break;case 2:r=v+b;break;case 3:r=v+((a+b)>>1);break;case 4:r=v+paeth(a,b,c);break;}out[ro+x]=r&255;}}
  return {W,H,ch,data:out};
}

/* ── 偵測內容範圍（與四角背景色差異夠大者） ── */
function contentBox(src,thr=24){
  const {W,H,ch,data}=src; const bg=[data[0],data[1],data[2]];
  let minX=W,minY=H,maxX=0,maxY=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*ch;
    if(Math.abs(data[i]-bg[0])+Math.abs(data[i+1]-bg[1])+Math.abs(data[i+2]-bg[2])>thr){
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}
  return {minX,minY,maxX,maxY,bg};
}

/* ── 從來源指定方形區域，面積平均縮放成 T×T RGBA（合成到白底） ── */
function resizeRegion(src,sx0,sy0,side,T){
  const {W,H,ch,data}=src, out=Buffer.alloc(T*T*4);
  const sample=(fx,fy)=>{ // 最近像素（已超取樣，足夠）；超出邊界視為白
    const x=Math.round(fx),y=Math.round(fy); if(x<0||y<0||x>=W||y>=H)return [255,255,255,255];
    const i=(y*W+x)*ch; return [data[i],data[i+1],data[i+2],ch===4?data[i+3]:255]; };
  for(let ty=0;ty<T;ty++)for(let tx=0;tx<T;tx++){
    // 每個目標像素對應來源一小塊，平均之
    const u0=sx0+tx*side/T, u1=sx0+(tx+1)*side/T, v0=sy0+ty*side/T, v1=sy0+(ty+1)*side/T;
    let r=0,g=0,b=0,n=0; const step=Math.max(1,Math.floor((u1-u0)/3));
    for(let sy=Math.floor(v0);sy<Math.ceil(v1);sy+=step)for(let sx=Math.floor(u0);sx<Math.ceil(u1);sx+=step){
      const c=sample(sx,sy),af=c[3]/255; r+=c[0]*af+255*(1-af); g+=c[1]*af+255*(1-af); b+=c[2]*af+255*(1-af); n++; }
    if(n===0){const c=sample((u0+u1)/2,(v0+v1)/2),af=c[3]/255;r=c[0]*af+255*(1-af);g=c[1]*af+255*(1-af);b=c[2]*af+255*(1-af);n=1;}
    const o=(ty*T+tx)*4; out[o]=Math.round(r/n);out[o+1]=Math.round(g/n);out[o+2]=Math.round(b/n);out[o+3]=255;
  }
  return out;
}

const master=decodePNG(fs.readFileSync(path.join(__dirname,"..","assets","app-icon-master.png")));
const box=contentBox(master);
const cx=(box.minX+box.maxX)/2, cy=(box.minY+box.maxY)/2;
const contentSide=Math.max(box.maxX-box.minX, box.maxY-box.minY);
const FILL=0.86; // 內容占方格比例（其餘為安全邊距，避免文字被 iOS 圓角切掉）
let side=contentSide/FILL;
let sx0=cx-side/2, sy0=cy-side/2;
// 夾在影像內（必要時縮小裁切框）
side=Math.min(side, master.W, master.H);
sx0=Math.max(0,Math.min(sx0, master.W-side));
sy0=Math.max(0,Math.min(sy0, master.H-side));
console.log("content",box,"crop",{sx0:Math.round(sx0),sy0:Math.round(sy0),side:Math.round(side)},"fill",FILL);

const outDir=path.join(__dirname,"..","public");
for(const T of [180,192,512]){ const rgba=resizeRegion(master,sx0,sy0,side,T); fs.writeFileSync(path.join(outDir,`icon-${T}.png`),encodePNG(T,T,rgba)); console.log("wrote icon-"+T); }
