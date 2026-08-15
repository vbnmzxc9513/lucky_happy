const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

const imgDir = path.join(__dirname, 'host', 'assets');

function getRgba(c) {
  return {
    r: (c >> 24) & 255,
    g: (c >> 16) & 255,
    b: (c >> 8) & 255,
    a: c & 255
  };
}

async function processImage(filePath) {
  const parsed = path.parse(filePath);
  if (parsed.ext.toLowerCase() !== '.jpg' && parsed.ext.toLowerCase() !== '.jpeg') return;
  
  const img = await Jimp.read(filePath);
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  
  const visited = new Uint8Array(w * h);
  const q = [];
  
  const pushIfValid = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    
    const hex = img.getPixelColor(x, y);
    const rgba = getRgba(hex);
    
    // white tolerance
    if (rgba.r > 240 && rgba.g > 240 && rgba.b > 240) {
      visited[idx] = 1;
      q.push({x, y});
    }
  };
  
  for (let x = 0; x < w; x++) {
    pushIfValid(x, 0);
    pushIfValid(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIfValid(0, y);
    pushIfValid(w - 1, y);
  }
  
  let head = 0;
  while(head < q.length) {
    const {x, y} = q[head++];
    pushIfValid(x - 1, y);
    pushIfValid(x + 1, y);
    pushIfValid(x, y - 1);
    pushIfValid(x, y + 1);
  }
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (visited[y * w + x]) {
        img.setPixelColor(0x00000000, x, y);
      }
    }
  }
  
  // Flip cowboy
  if (parsed.name.includes('cowboy')) {
    img.flip(true, false);
  }
  
  const newPath = path.join(imgDir, parsed.name + '.png');
  await img.writeAsync(newPath);
  console.log(`Processed ${parsed.base} -> ${parsed.name}.png`);
}

async function main() {
  const files = fs.readdirSync(imgDir);
  for (const f of files) {
    await processImage(path.join(imgDir, f));
  }
  console.log("All done!");
}

main().catch(console.error);
