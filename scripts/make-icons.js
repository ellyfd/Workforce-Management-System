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

  // 圓角矩形描邊
  const rstroke = (x0, y0, x1, y1, rad, w, col) => {
    for (let y = Math.floor(y0) - 1; y < Math.ceil(y1) + 1; y++) {
      for (let x = Math.floor(x0) - 1; x < Math.ceil(x1) + 1; x++) {
        let dx = 0, dy = 0;
        if (x < x0 + rad) dx = x0 + rad - x;
        else if (x > x1 - rad) dx = x - (x1 - rad);
        if (y < y0 + rad) dy = y0 + rad - y;
        else if (y > y1 - rad) dy = y - (y1 - rad);
        const inRound = (x < x0 + rad || x > x1 - rad) && (y < y0 + rad || y > y1 - rad);
        const d = Math.sqrt(dx * dx + dy * dy);
        const edge = inRound ? Math.abs(d - rad)
          : Math.min(Math.abs(x - x0), Math.abs(x - x1), Math.abs(y - y0), Math.abs(y - y1));
        const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1 && (!inRound || d <= rad);
        if (inside && edge <= w) set(x, y, col[0], col[1], col[2], 255);
      }
    }
  };

  // 配色（淺色白底＋藍框，呼應目前淺色介面）
  const blue = [37, 99, 235];      // #2563eb
  const white = [255, 255, 255];
  const pink = [236, 72, 153];     // #ec4899（出差色系）
  const gray = [203, 213, 225];    // 日期格淡灰
  const bg = [245, 247, 250];      // 淺色底

  // 淺色底（iOS 會自動套圓角遮罩）
  for (let i = 0; i < S * S; i++) {
    buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255;
  }

  // 行事曆框：留多一點四周空白（依 iOS 標準，圖案不貼邊）。
  // margin 為圖案到邊緣的留白比例；行事曆置中。
  const margin = 0.26;
  const calW = (1 - 2 * margin) * S;
  const calH = calW * 0.84;                 // 略寬於高
  const cx0 = S * margin, cx1 = S - S * margin;
  const cy0 = (S - calH) / 2, cy1 = (S + calH) / 2;
  const rad = calW * 0.13, headH = calH * 0.26;

  rrect(cx0, cy0, cx1, cy1, rad, white);
  rstroke(cx0, cy0, cx1, cy1, rad, Math.max(3, S * 0.011), blue);
  // 上方藍色標頭帶
  rrect(cx0, cy0, cx1, cy0 + headH, rad, blue);
  rrect(cx0, cy0 + headH - rad, cx1, cy0 + headH, 0, blue);

  // 日期格點（3x2 小方塊），尺寸依行事曆框換算以保持內邊距且不溢出。
  // 右下角一格用粉色強調（＝出差）。
  const padX = calW * 0.13, padBottom = calH * 0.1;
  const gridW = calW - 2 * padX;
  const cell = gridW / 3.8;                  // 3 格 + 2 個 0.4cell 間距
  const gap = cell * 0.4;
  const gx0 = cx0 + padX;
  const bodyTop = cy0 + headH + calH * 0.08;
  const bodyBottom = cy1 - padBottom;
  const gy0 = bodyTop + ((bodyBottom - bodyTop) - (2 * cell + gap)) / 2;
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
