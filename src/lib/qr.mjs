// Local QR drawing for a Google Drive file link. Nothing is sent to a chart service.
import qrcode from "qrcode-generator";

export function qrSvg(text) {
  const value = String(text || "");
  if (!value) throw new Error("empty QR text");
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const cell = 4;
  const margin = 4;
  const size = (count + margin * 2) * cell;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + margin) * cell;
      const y = (row + margin) * cell;
      path += `M${x} ${y}h${cell}v${cell}h-${cell}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for the Google Drive file"><rect width="100%" height="100%" fill="#fff"/><path fill="#111" d="${path}"/></svg>`;
}
