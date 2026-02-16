/**
 * Generates frontend/public/brand/ favicon.ico, apple-touch-icon.png, og.png from brand/logo.png
 * Run from frontend: node scripts/generate-brand-assets.mjs
 */
import sharp from "sharp";
import sharpIco from "sharp-ico";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.join(__dirname, "..", "public", "brand");
const logoPath = path.join(brandDir, "logo.png");

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function main() {
  const img = sharp(logoPath);
  const meta = await img.metadata();
  const { width: w, height: h } = meta;
  const cropHeight = Math.round(h * 0.42);
  const mark = await img.extract({ left: 0, top: 0, width: w, height: cropHeight });

  const size32 = await mark
    .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const size16 = await mark
    .resize(16, 16, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const ico = sharpIco.encode([size16, size32]);
  writeFileSync(path.join(brandDir, "favicon.ico"), ico);

  const apple180 = await sharp(logoPath)
    .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  writeFileSync(path.join(brandDir, "apple-touch-icon.png"), apple180);

  const logoBuffer = readFileSync(logoPath);
  const logoBase64 = logoBuffer.toString("base64");
  const logoMeta = await sharp(logoBuffer).metadata();
  const lw = logoMeta.width;
  const lh = logoMeta.height;
  const W = 1200;
  const H = 630;
  const BG = "#0a0a0b";
  const maxLogoW = 520;
  const maxLogoH = 140;
  const scale = Math.min(maxLogoW / lw, maxLogoH / lh, 1);
  const outLw = Math.round(lw * scale);
  const outLh = Math.round(lh * scale);
  const logoX = (W - outLw) / 2;
  const logoY = H * 0.38 - outLh / 2;
  const taglineY = H * 0.72;
  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <image href="data:image/png;base64,${logoBase64}" x="${logoX}" y="${logoY}" width="${outLw}" height="${outLh}"/>
  <text x="${W / 2}" y="${taglineY}" text-anchor="middle" fill="#e5e5e5" font-family="system-ui, sans-serif" font-size="32" font-weight="400">${escapeXml("Commercial Real Estate Financial Modeling")}</text>
</svg>`;
  const ogPng = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(path.join(brandDir, "og.png"), ogPng);

  console.log("brand/favicon.ico, brand/apple-touch-icon.png, brand/og.png written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
