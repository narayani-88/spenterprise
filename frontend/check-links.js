const fs=require('fs');
const path=require('path');
const files=fs.readdirSync('.').filter(f=>f.endsWith('.html'));
let hasError=false;
files.forEach(f=>{
  const c=fs.readFileSync(f,'utf8');
  const m=c.match(/href=['"`]?([^'"`>]+)['"`]?/g);
  if(m){
    m.forEach(l=>{
      let href=l.substring(6, l.length-1);
      if(href.startsWith('/') && !href.startsWith('//')) href=href.substring(1);
      if(href.startsWith('http') || href.startsWith('mailto') || href.startsWith('tel') || href.includes('?') || href.includes('#')) return;
      const p=path.join(__dirname, href);
      if(!fs.existsSync(p)){
        console.log('Broken link in ' + f + ': ' + href);
        hasError=true;
      }
    });
  }
});
if(!hasError) console.log('No broken links found');
