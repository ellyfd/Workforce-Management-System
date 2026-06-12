// 產生 PWA / 加到主畫面用的圖示（藍底＋白色行事曆，呼應 App 主題）。
// 純 Node（用 zlib 自己編碼 PNG），不需要任何外部工具。
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  // rest 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(S) {
  const buf = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const ia = a / 255, na = 1 - ia;
    buf[i] = Math.round(r * ia + buf[i] * na);
    buf[i + 1] = Math.round(g * ia + buf[i + 1] * na);
    buf[i + 2] = Math.round(b * ia + buf[i + 2] * na);
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  // 圓角矩形（含簡單邊緣柔化）
  const rrect = (x0, y0, x1, y1, rad, col) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        // 與圓角中心的距離
        let dx = 0, dy = 0;
        if (x < x0 + rad) dx = x0 + rad - x;
        else if (x > x1 - rad) dx = x - (x1 - rad);
        if (y < y0 + rad) dy = y0 + rad - y;
        else if (y > y1 - rad) dy = y - (y1 - rad);
        const d = Math.sqrt(dx * dx + dy * dy);
        let a = 255;
        if (d > rad) continue;
        if (d > rad - 1.2) a = Math.round(255 * (rad - d) / 1.2);
        set(x, y, col[0], col[1], col[2], a);
      }
    }
  };

  // 背景藍（全幅，iOS 會自動套圓角遮罩）
  const blue = [37, 99, 235];      // #2563eb
  const white = [255, 255, 255];
  const pink = [236, 72, 153];     // #ec4899（出差色系）
  const gray = [203, 213, 225];    // 日期格淡灰
  for (let i = 0; i < S * S; i++) {
    buf[i * 4] = blue[0]; buf[i * 4 + 1] = blue[1]; buf[i * 4 + 2] = blue[2]; buf[i * 4 + 3] = 255;
  }

  // 行事曆白色本體
  const cx0 = S * 0.20, cx1 = S * 0.80, cy0 = S * 0.26, cy1 = S * 0.78;
  const rad = S * 0.07;
  rrect(cx0, cy0, cx1, cy1, rad, white);
  // 上方粉色標頭帶
  const headH = S * 0.15;
  rrect(cx0, cy0, cx1, cy0 + headH, rad, pink);
  // 標頭下緣補成直角（蓋掉底部圓角）
  rrect(cx0, cy0 + headH - rad, cx1, cy0 + headH, 0, pink);

  // 兩個掛環
  const ringW = S * 0.045, ringH = S * 0.10;
  const ringY0 = cy0 - ringH * 0.5;
  for (const fx of [0.36, 0.64]) {
    const rx = S * fx;
    rrect(rx - ringW / 2, ringY0, rx + ringW / 2, ringY0 + ringH, ringW / 2, blue);
  }

  // 日期格點（3x2 小方塊），右下角一格用粉色強調（＝出差）
  const gx0 = cx0 + S * 0.07, gy0 = cy0 + headH + S * 0.06;
  const cell = S * 0.105, gap = S * 0.05;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = gx0 + c * (cell + gap);
      const y = gy0 + r * (cell + gap);
      const col = (r === 1 && c === 2) ? pink : gray;
      rrect(x, y, x + cell, y + cell, cell * 0.28, col);
    }
  }
  return buf;
}

const outDir = path.join(__dirname, "..", "public");
for (const S of [180, 192, 512]) {
  const png = encodePNG(S, S, draw(S));
  const file = path.join(outDir, `icon-${S}.png`);
  fs.writeFileSync(file, png);
  console.log("wrote", file, png.length, "bytes");
}
