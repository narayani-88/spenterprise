const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync('../company-dashboard.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const window = dom.window;

const pages = ['page-nwf', 'page-members', 'page-kyc', 'page-deposits', 'page-withdrawals', 'page-transactions', 'page-inquiries'];
pages.forEach(p => {
  const page = window.document.getElementById(p);
  if (page) {
    let curr = page.parentNode;
    console.log(p, 'parent is:', curr ? curr.tagName + ' ' + curr.id + ' ' + curr.className : 'null');
  } else {
    console.log(p, 'is missing');
  }
});
