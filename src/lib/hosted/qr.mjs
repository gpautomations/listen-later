// SPDX-License-Identifier: GPL-3.0-or-later
import qrcode from "qrcode-generator";

export function qrMatrix(text) {
  const qr = qrcode(0, "M");
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(!!qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

export function drawQr(canvas, text) {
  const rows = qrMatrix(text);
  const n = rows.length;
  const scale = Math.max(3, Math.floor((canvas.width || 180) / (n + 8)));
  const size = scale * (n + 8);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#111111";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (rows[r][c]) ctx.fillRect((c + 4) * scale, (r + 4) * scale, scale, scale);
    }
  }
  return canvas;
}
