/**
 * Generates favicon.ico, favicon-16x16.png, favicon-32x32.png from logo mark only (top crop of logo).
 * Run from frontend: node scripts/generate-favicons.mjs
 */
import sharp from "sharp";
import toIco from "to-ico";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const logoPath = path.join(publicDir, "logo.png");

async function main() {
  const img = sharp(logoPath);
  const meta = await img.metadata();
  const { width: w, height: h } = meta;
  // Crop to logo mark only (top ~42% = graphic, not wordmark)
  const cropHeight = Math.round(h * 0.42);
  const mark = await img
    .extract({ left: 0, top: 0, width: w, height: cropHeight });

  const size32 = await mark
    .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const size16 = await mark
    .resize(16, 16, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  writeFileSync(path.join(publicDir, "favicon-32x32.png"), size32);
  writeFileSync(path.join(publicDir, "favicon-16x16.png"), size16);

  const ico = await toIco([size16, size32]);
  writeFileSync(path.join(publicDir, "favicon.ico"), ico);

  console.log("Favicons written: favicon.ico, favicon-16x16.png, favicon-32x32.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
