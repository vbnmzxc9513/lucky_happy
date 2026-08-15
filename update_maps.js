const fs = require('fs');
const path = require('path');

const mapDir = path.join(__dirname, 'data', 'maps');
const files = fs.readdirSync(mapDir).filter(f => f.endsWith('.json'));

for (const file of files) {
  const filePath = path.join(mapDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (data.track) {
    data.track.length = 15000;
  }
  
  if (data.config) {
    if (data.config.baseBoost !== undefined) {
      data.config.baseBoost = 0.5;
    }
    if (data.config.maxSpeed !== undefined) {
      data.config.maxSpeed = 20.0;
    }
  }
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated ${file}`);
}
