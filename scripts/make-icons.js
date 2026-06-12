// 由主人提供的正式 Logo（assets/app-icon-master.png, 1024x1024）產生
// 加到主畫面用的 icon-180/192/512.png。
// 環境無 convert/canvas/npm，於是自寫 PNG 解碼 + 面積平均縮放 + 重新編碼。純 Node。
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

/* ── PNG 編碼（RGBA） ── */
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return(~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const body=Buffer.concat([Buffer.from(type,"ascii"),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,crc]);}
function encodePNG(W,H,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;const stride=W*4;const raw=Buffer.alloc((stride+1)*H);for(let y=0;y<H;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride);}return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);}

/* ── PNG 解碼（支援 colortype 2=RGB / 6=RGBA, 8-bit, 非交錯） ── */
function decodePNG(buf){
  if(buf.readUInt32BE(0)!==0x89504e47) throw new Error("not png");
  const W=buf.readUInt32BE(16), H=buf.readUInt32BE(20), bd=buf[24], ct=buf[25], il=buf[28];
  if(bd!==8||il!==0||(ct!==2&&ct!==6)) throw new Error("unsupported png ct="+ct+" bd="+bd+" il="+il);
  const ch=ct===6?4:3;
  // 收集所有 IDAT
  let p=33, idat=[];
  while(p<buf.length){ const len=buf.readUInt32BE(p), type=buf.toString("ascii",p+4,p+8); if(type==="IDAT")idat.push(buf.slice(p+8,p+8+len)); if(type==="IEND")break; p+=12+len; }
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const stride=W*ch, out=Buffer.alloc(stride*H); let rp=0;
  const paeth=(a,b,c)=>{const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<H;y++){ const f=raw[rp++]; const ro=y*stride, po=(y-1)*stride;
    for(let x=0;x<stride;x++){ const v=raw[rp++]; const a=x>=ch?out[ro+x-ch]:0, b=y>0?out[po+x]:0, c=(x>=ch&&y>0)?out[po+x-ch]:0;
      let r; switch(f){case 0:r=v;break;case 1:r=v+a;break;case 2:r=v+b;break;case 3:r=v+((a+b)>>1);break;case 4:r=v+paeth(a,b,c);break;default:throw new Error("bad filter "+f);} out[ro+x]=r&0xff; } }
  return {W,H,ch,data:out};
}

/* ── 面積平均縮放 → RGBA（不透明背景補白） ── */
function resizeArea(src,T){
  const {W,H,ch,data}=src, out=Buffer.alloc(T*T*4);
  for(let ty=0;ty<T;ty++){ const sy0=ty*H/T, sy1=(ty+1)*H/T;
    for(let tx=0;tx<T;tx++){ const sx0=tx*W/T, sx1=(tx+1)*W/T;
      let r=0,g=0,b=0,a=0,wsum=0;
      for(let sy=Math.floor(sy0);sy<Math.ceil(sy1);sy++){ const wy=Math.min(sy1,sy+1)-Math.max(sy0,sy);
        for(let sx=Math.floor(sx0);sx<Math.ceil(sx1);sx++){ const wx=Math.min(sx1,sx+1)-Math.max(sx0,sx); const w=wy*wx; if(w<=0)continue;
          const i=(sy*W+sx)*ch; const al=ch===4?data[i+3]:255;
          r+=data[i]*w; g+=data[i+1]*w; b+=data[i+2]*w; a+=al*w; wsum+=w; } }
      const o=(ty*T+tx)*4, af=a/wsum/255;
      // 合成到白底（去掉透明，App 圖示用不透明）
      out[o]=Math.round(r/wsum*af+255*(1-af));
      out[o+1]=Math.round(g/wsum*af+255*(1-af));
      out[o+2]=Math.round(b/wsum*af+255*(1-af));
      out[o+3]=255;
    } }
  return out;
}

const master=decodePNG(fs.readFileSync(path.join(__dirname,"..","assets","app-icon-master.png")));
console.log("master",master.W+"x"+master.H,"ch",master.ch);
const outDir=path.join(__dirname,"..","public");
for(const T of [180,192,512]){ const rgba=resizeArea(master,T); const file=path.join(outDir,`icon-${T}.png`); fs.writeFileSync(file,encodePNG(T,T,rgba)); console.log("wrote",file); }
