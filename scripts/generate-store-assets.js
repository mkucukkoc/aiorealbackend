/*
 * Generate store assets from existing app icon.
 * Requires 'canvas' (already in server dependencies).
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const ROOT = path.resolve(__dirname, '../../');
const ICON_PATH = path.resolve(ROOT, 'app/src/assets/icon.png');

const OUT_ROOT = path.resolve(ROOT, 'appstore');
const OUT_ANDROID = path.join(OUT_ROOT, 'android');
const OUT_IOS = path.join(OUT_ROOT, 'ios');
const OUT_TEMPLATES = path.join(OUT_ROOT, 'templates');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function drawCenteredImage(ctx, logo, canvasWidth, canvasHeight, coverage = 0.6) {
  const maxW = canvasWidth * coverage;
  const maxH = canvasHeight * coverage;
  const scale = Math.min(maxW / logo.width, maxH / logo.height);
  const drawW = Math.max(1, Math.floor(logo.width * scale));
  const drawH = Math.max(1, Math.floor(logo.height * scale));
  const dx = Math.floor((canvasWidth - drawW) / 2);
  const dy = Math.floor((canvasHeight - drawH) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(logo, dx, dy, drawW, drawH);
}

async function createPng(width, height, opts) {
  const { background = null, logo = null, text = null, textColor = '#FFFFFF' } = opts || {};
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  } else {
    // transparent background
    ctx.clearRect(0, 0, width, height);
  }
  if (logo) {
    await drawCenteredImage(ctx, logo, width, height, 0.6);
  }
  if (text) {
    ctx.font = `${Math.floor(height * 0.08)}px Sans-Serif`;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.fillText(text, Math.floor(width / 2), Math.floor(height * 0.9));
    ctx.globalAlpha = 1.0;
  }
  return canvas.toBuffer('image/png');
}

async function main() {
  ensureDir(OUT_ROOT);
  ensureDir(OUT_ANDROID);
  ensureDir(OUT_IOS);
  ensureDir(OUT_TEMPLATES);

  if (!fs.existsSync(ICON_PATH)) {
    throw new Error(`Icon not found at ${ICON_PATH}`);
  }
  const logo = await loadImage(ICON_PATH);

  // Android: Play icon (transparent OK)
  const androidIcon = await createPng(512, 512, { background: null, logo });
  fs.writeFileSync(path.join(OUT_ANDROID, 'icon-512.png'), androidIcon);

  // Android: Feature graphic 1024x500 (solid bg)
  const feature = await createPng(1024, 500, { background: '#232323', logo });
  fs.writeFileSync(path.join(OUT_ANDROID, 'feature-1024x500.png'), feature);

  // iOS: App Store icon 1024x1024 (no transparency allowed)
  const iosIcon = await createPng(1024, 1024, { background: '#232323', logo });
  fs.writeFileSync(path.join(OUT_IOS, 'icon-1024.png'), iosIcon);

  // Templates (placeholders for screenshots)
  const phone = await createPng(1080, 1920, { background: '#121212', logo: null, text: 'PLACEHOLDER PHONE 1080x1920' });
  fs.writeFileSync(path.join(OUT_TEMPLATES, 'phone-1080x1920.png'), phone);

  const tablet7 = await createPng(1200, 1920, { background: '#121212', logo: null, text: 'PLACEHOLDER TABLET 7\" 1200x1920' });
  fs.writeFileSync(path.join(OUT_TEMPLATES, 'tablet7-1200x1920.png'), tablet7);

  const tablet10 = await createPng(1600, 2560, { background: '#121212', logo: null, text: 'PLACEHOLDER TABLET 10\" 1600x2560' });
  fs.writeFileSync(path.join(OUT_TEMPLATES, 'tablet10-1600x2560.png'), tablet10);

  const iphone65 = await createPng(1242, 2688, { background: '#121212', logo: null, text: 'PLACEHOLDER iPhone 6.5\" 1242x2688' });
  fs.writeFileSync(path.join(OUT_IOS, 'iphone-65-1242x2688.png'), iphone65);

  console.log('Store assets generated under', OUT_ROOT);
}

main().catch((err) => {
  console.error('Failed to generate store assets:', err);
  process.exit(1);
});


