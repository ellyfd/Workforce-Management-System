// 產生多款候選圖示讓使用者挑選（輸出到 /tmp/icons）。純 Node 編碼 PNG。
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return(~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const t=Buffer.from(type,"ascii");const body=Buffer.concat([t,data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body),0);return Buffer.concat([len,body,crc]);}
function encodePNG(W,H,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;const stride=W*4;const raw=Buffer.alloc((stride+1)*H);for(let y=0;y<H;y++){raw[y*(stride+1)]=0;rgba.copy(raw,y*(stride+1)+1,y*stride,y*stride+stride);}const idat=zlib.deflateSync(raw,{level:9});return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",idat),chunk("IEND",Buffer.alloc(0))]);}

function canvas(S){
  const buf=Buffer.alloc(S*S*4);
  const set=(x,y,r,g,b,a=255)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=S||y>=S)return;const i=(y*S+x)*4;const ia=a/255,na=1-ia;buf[i]=Math.round(r*ia+buf[i]*na);buf[i+1]=Math.round(g*ia+buf[i+1]*na);buf[i+2]=Math.round(b*ia+buf[i+2]*na);buf[i+3]=Math.max(buf[i+3],a);};
  const fill=(col)=>{for(let i=0;i<S*S;i++){buf[i*4]=col[0];buf[i*4+1]=col[1];buf[i*4+2]=col[2];buf[i*4+3]=255;}};
  const vgrad=(top,bot)=>{for(let y=0;y<S;y++){const t=y/(S-1);const r=top[0]+(bot[0]-top[0])*t,g=top[1]+(bot[1]-top[1])*t,b=top[2]+(bot[2]-top[2])*t;for(let x=0;x<S;x++){const i=(y*S+x)*4;buf[i]=r;buf[i+1]=g;buf[i+2]=b;buf[i+3]=255;}}};
  const dgrad=(c1,c2)=>{for(let y=0;y<S;y++)for(let x=0;x<S;x++){const t=(x+y)/(2*(S-1));const i=(y*S+x)*4;buf[i]=c1[0]+(c2[0]-c1[0])*t;buf[i+1]=c1[1]+(c2[1]-c1[1])*t;buf[i+2]=c1[2]+(c2[2]-c1[2])*t;buf[i+3]=255;}};
  const rrect=(x0,y0,x1,y1,rad,col,a=255)=>{for(let y=Math.floor(y0);y<Math.ceil(y1);y++)for(let x=Math.floor(x0);x<Math.ceil(x1);x++){let dx=0,dy=0;if(x<x0+rad)dx=x0+rad-x;else if(x>x1-rad)dx=x-(x1-rad);if(y<y0+rad)dy=y0+rad-y;else if(y>y1-rad)dy=y-(y1-rad);const d=Math.sqrt(dx*dx+dy*dy);if(d>rad)continue;let aa=a;if(d>rad-1.2)aa=a*(rad-d)/1.2;set(x,y,col[0],col[1],col[2],aa);}};
  const rrectStroke=(x0,y0,x1,y1,rad,w,col)=>{for(let y=Math.floor(y0)-1;y<Math.ceil(y1)+1;y++)for(let x=Math.floor(x0)-1;x<Math.ceil(x1)+1;x++){let dx=0,dy=0;if(x<x0+rad)dx=x0+rad-x;else if(x>x1-rad)dx=x-(x1-rad);if(y<y0+rad)dy=y0+rad-y;else if(y>y1-rad)dy=y-(y1-rad);const d=Math.sqrt(dx*dx+dy*dy);const inRound=(x<x0+rad||x>x1-rad)&&(y<y0+rad||y>y1-rad);const edgeDist=inRound?Math.abs(d-rad):Math.min(Math.abs(x-x0),Math.abs(x-x1),Math.abs(y-y0),Math.abs(y-y1));const inside=x>=x0&&x<=x1&&y>=y0&&y<=y1&&(!inRound||d<=rad);if(inside&&edgeDist<=w)set(x,y,col[0],col[1],col[2],255);}};
  const disc=(cx,cy,r,col,a=255)=>{for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++)for(let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++){const d=Math.hypot(x-cx,y-cy);if(d>r)continue;let aa=a;if(d>r-1.2)aa=a*(r-d)/1.2;set(x,y,col[0],col[1],col[2],aa);}};
  // 粗線段（圓頭）
  const line=(x1,y1,x2,y2,w,col)=>{const steps=Math.ceil(Math.hypot(x2-x1,y2-y1));for(let s=0;s<=steps;s++){const t=s/steps;disc(x1+(x2-x1)*t,y1+(y2-y1)*t,w/2,col);}};
  return {buf,set,fill,vgrad,dgrad,rrect,rrectStroke,disc,line};
}

const BLUE=[37,99,235],WHITE=[255,255,255],PINK=[236,72,153],GRAY=[203,213,225],
      INDIGO=[79,70,229],PURPLE=[147,51,234],SLATE=[30,41,59],SKY=[56,189,248],
      AMBER=[245,158,11],GREEN=[22,163,74],TEAL=[13,148,136],ROSE=[244,63,94];

// 行事曆主體（給多款共用）
function calendar(c,S,{bg,body,header,dot,accent}){
  const cx0=S*0.20,cx1=S*0.80,cy0=S*0.27,cy1=S*0.77,rad=S*0.07,headH=S*0.15;
  c.rrect(cx0,cy0,cx1,cy1,rad,body);
  c.rrect(cx0,cy0,cx1,cy0+headH,rad,header);
  c.rrect(cx0,cy0+headH-rad,cx1,cy0+headH,0,header);
  const ringW=S*0.045,ringH=S*0.10,ringY0=cy0-ringH*0.5;
  for(const fx of [0.36,0.64]){const rx=S*fx;c.rrect(rx-ringW/2,ringY0,rx+ringW/2,ringY0+ringH,ringW/2,bg);}
  const gx0=cx0+S*0.07,gy0=cy0+headH+S*0.055,cell=S*0.105,gap=S*0.05;
  for(let r=0;r<2;r++)for(let col=0;col<3;col++){const x=gx0+col*(cell+gap),y=gy0+r*(cell+gap);const cc=(r===1&&col===2)?accent:dot;c.rrect(x,y,x+cell,y+cell,cell*0.28,cc);}
}

const variants={
  // 1) 原版：藍底白行事曆
  blue_cal:(c,S)=>{c.fill(BLUE);calendar(c,S,{bg:BLUE,body:WHITE,header:PINK,dot:GRAY,accent:PINK});},
  // 2) 靛紫漸層底白行事曆
  indigo_grad:(c,S)=>{c.dgrad(INDIGO,PURPLE);calendar(c,S,{bg:INDIGO,body:WHITE,header:PINK,dot:[226,232,240],accent:PINK});},
  // 3) 淺色：白底藍線行事曆
  light_cal:(c,S)=>{c.fill([245,247,250]);const cx0=S*0.19,cx1=S*0.81,cy0=S*0.26,cy1=S*0.78,rad=S*0.08,headH=S*0.15;c.rrect(cx0,cy0,cx1,cy1,rad,WHITE);c.rrectStroke(cx0,cy0,cx1,cy1,rad,Math.max(3,S*0.012),BLUE);c.rrect(cx0,cy0,cx1,cy0+headH,rad,BLUE);c.rrect(cx0,cy0+headH-rad,cx1,cy0+headH,0,BLUE);const gx0=cx0+S*0.075,gy0=cy0+headH+S*0.055,cell=S*0.1,gap=S*0.052;for(let r=0;r<2;r++)for(let col=0;col<3;col++){const x=gx0+col*(cell+gap),y=gy0+r*(cell+gap);c.rrect(x,y,x+cell,y+cell,cell*0.28,(r===1&&col===2)?PINK:[203,213,225]);}},
  // 4) 行事曆＋打勾（藍底）
  check_cal:(c,S)=>{c.fill(BLUE);calendar(c,S,{bg:BLUE,body:WHITE,header:[96,165,250],dot:[219,234,254],accent:[219,234,254]});const cx=S*0.5,cy=S*0.58;c.line(cx-S*0.11,cy,cx-S*0.02,cy+S*0.1,S*0.055,GREEN);c.line(cx-S*0.02,cy+S*0.1,cx+S*0.15,cy-S*0.12,S*0.055,GREEN);},
  // 5) 度假風：晴空＋太陽（休假）
  sun:(c,S)=>{c.vgrad(SKY,[14,165,233]);c.disc(S*0.5,S*0.42,S*0.16,[255,221,87]);for(let i=0;i<12;i++){const a=i/12*Math.PI*2,r0=S*0.2,r1=S*0.26;c.line(S*0.5+Math.cos(a)*r0,S*0.42+Math.sin(a)*r0,S*0.5+Math.cos(a)*r1,S*0.42+Math.sin(a)*r1,S*0.022,[255,221,87]);}c.rrect(0,S*0.66,S,S*0.78,0,WHITE,230);c.rrect(0,S*0.78,S,S,0,[37,99,235],255);},
  // 6) 圓徽：粉藍漸層圓＋行事曆
  badge:(c,S)=>{c.fill([248,250,252]);c.disc(S*0.5,S*0.5,S*0.42,INDIGO);for(let y=0;y<S;y++)for(let x=0;x<S;x++){if(Math.hypot(x-S*0.5,y-S*0.5)<=S*0.42){const t=(x+y)/(2*S);const i=(y*S+x)*4;buf2(c,i,INDIGO,PINK,t);}}calendar(c,S,{bg:INDIGO,body:WHITE,header:PINK,dot:[226,232,240],accent:PINK});},
};
function buf2(c,i,c1,c2,t){c.buf[i]=c1[0]+(c2[0]-c1[0])*t;c.buf[i+1]=c1[1]+(c2[1]-c1[1])*t;c.buf[i+2]=c1[2]+(c2[2]-c1[2])*t;}

const outDir="/tmp/icons";
fs.mkdirSync(outDir,{recursive:true});
const S=384;
for(const [name,fn] of Object.entries(variants)){
  const c=canvas(S);fn(c,S);
  const png=encodePNG(S,S,c.buf);
  fs.writeFileSync(path.join(outDir,name+".png"),png);
  console.log("wrote",name);
}
// 另外輸出一張 2x3 拼貼方便一次看
(function sheet(){
  const cols=3,rows=2,pad=24,tile=384;
  const W=cols*tile+(cols+1)*pad,H=rows*tile+(rows+1)*pad;
  const c=canvas(1);// dummy
  const big=Buffer.alloc(W*H*4);
  for(let i=0;i<W*H;i++){big[i*4]=238;big[i*4+1]=240;big[i*4+2]=244;big[i*4+3]=255;}
  const names=Object.keys(variants);
  names.forEach((name,idx)=>{
    const cc=canvas(tile);variants[name](cc,tile);
    const col=idx%cols,row=Math.floor(idx/cols);
    const ox=pad+col*(tile+pad),oy=pad+row*(tile+pad);
    for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){const si=(y*tile+x)*4,di=((oy+y)*W+(ox+x))*4;big[di]=cc.buf[si];big[di+1]=cc.buf[si+1];big[di+2]=cc.buf[si+2];big[di+3]=255;}
  });
  fs.writeFileSync(path.join(outDir,"_sheet.png"),encodePNG(W,H,big));
  console.log("wrote _sheet");
})();
