/**
 * Generates public/og-image.png (1200x630) for social sharing: dark theme, logo + tagline.
 * Run from frontend: node scripts/generate-og-image.mjs
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const logoPath = path.join(publicDir, "logo.png");

const W = 1200;
const H = 630;
const BG = "#0a0a0b";
const TAGLINE = "Commercial Real Estate Financial Modeling";

async function main() {
  const logoBuffer = readFileSync(logoPath);
  const logoBase64 = logoBuffer.toString("base64");
  const meta = await sharp(logoBuffer).metadata();
  const logoW = meta.width;
  const logoH = meta.height;
  const maxLogoW = 520;
  const maxLogoH = 140;
  const scale = Math.min(maxLogoW / logoW, maxLogoH / logoH, 1);
  const lw = Math.round(logoW * scale);
  const lh = Math.round(logoH * scale);
  const logoX = (W - lw) / 2;
  const logoY = H * 0.38 - lh / 2;
  const taglineY = H * 0.72;

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <image href="data:image/png;base64,${logoBase64}" x="${logoX}" y="${logoY}" width="${lw}" height="${lh}"/>
  <text x="${W / 2}" y="${taglineY}" text-anchor="middle" fill="#e5e5e5" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="400">${escapeXml(TAGLINE)}</text>
</svg>`;

  const png = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();
  writeFileSync(path.join(publicDir, "og-image.png"), png);
  console.log("og-image.png written (1200x630).");
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
