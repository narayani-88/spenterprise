const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Assuming local dev server is running on 5000? Wait, there's no server running.
  // I will just use a file:// URL.
  const fileUrl = 'file://' + path.resolve('../company-dashboard.html');
  await page.goto(fileUrl);
  
  // We need to simulate being logged in (localStorage)
  await page.evaluate(() => {
    localStorage.setItem('token', 'fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'admin', name: 'Book Apna Plot' }));
  });
  
  // Reload to apply localStorage
  await page.goto(fileUrl);

  // Mock API calls
  await page.evaluate(() => {
    window.apiCall = async function(method, url) {
      if (url.includes('/admin/contacts')) return [{ id: 1, name: 'Test', email: 'test@test.com', message: 'Hello', created_at: new Date().toISOString() }];
      return [];
    };
  });

  // Switch to inquiries page
  await page.evaluate(() => {
    window.switchPage('inquiries');
  });

  // Wait for animation or rendering
  await page.waitForTimeout(1000);

  // Check the layout box of page-inquiries
  const box = await page.evaluate(() => {
    const el = document.getElementById('page-inquiries');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      classes: el.className
    };
  });

  console.log('page-inquiries info:', box);

  const mainBox = await page.evaluate(() => {
    const el = document.querySelector('.main-content');
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  console.log('main-content info:', mainBox);

  // Also check if ANY element is overlapping
  await page.screenshot({ path: 'screenshot.png' });

  await browser.close();
})();
