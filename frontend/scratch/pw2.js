const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const fileUrl = 'file://' + path.resolve('../company-dashboard.html');
  await page.goto(fileUrl);
  
  await page.evaluate(() => {
    localStorage.setItem('token', 'fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'admin', name: 'Book Apna Plot' }));
  });
  
  await page.goto(fileUrl);
  await page.evaluate(() => { window.switchPage('inquiries'); });
  await page.waitForTimeout(500);

  const boxes = await page.evaluate(() => {
    const pageEl = document.getElementById('page-inquiries');
    const cardEl = pageEl.querySelector('.card');
    const mainEl = document.querySelector('.main-content');
    
    return {
      main: mainEl.getBoundingClientRect(),
      page: pageEl.getBoundingClientRect(),
      card: cardEl ? cardEl.getBoundingClientRect() : null,
      pageHTML: pageEl.innerHTML.substring(0, 500)
    };
  });

  console.log(JSON.stringify(boxes, null, 2));

  await browser.close();
})();
