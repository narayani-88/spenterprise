const fs = require('fs');
const html = fs.readFileSync('../frontend/company-dashboard.html', 'utf8');
const lines = html.split('\n');
let depth = 0;
let inNwf = false;

for(let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('id="page-nwf"')) {
    inNwf = true;
    depth = 1;
    console.log(`[Line ${i+1}] START NWF (Depth: ${depth})`);
    continue;
  }
  if (!inNwf) continue;
  
  const opens = (line.match(/<div[^>]*>/g) || []).length;
  const closes = (line.match(/<\/div>/g) || []).length;
  depth += opens - closes;
  
  if (opens !== closes) {
    console.log(`[Line ${i+1}] Depth ${depth} (+${opens} -${closes}) | ${line.trim().substring(0, 50)}`);
  }
  
  if (depth <= 0) {
    console.log(`[Line ${i+1}] END NWF (Depth: ${depth})`);
    inNwf = false;
    break;
  }
}
