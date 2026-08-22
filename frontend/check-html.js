const fs = require('fs');
const content = fs.readFileSync('company-dashboard.html', 'utf8');
let depth = 0;
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const opens = (l.match(/<div/g) || []).length;
  const closes = (l.match(/<\/div>/g) || []).length;
  depth += (opens - closes);
  if (l.includes('class="page"') || l.includes('class="page active"')) {
    console.log('Page at line ' + (i+1) + ' has depth ' + depth);
  }
}
