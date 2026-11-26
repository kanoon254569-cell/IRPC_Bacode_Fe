const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', m => console.log('CONSOLE:', m.text()));
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:4200/job-accept', { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('goto err', e.message));
  await page.waitForTimeout(1500);
  console.log('URL:', page.url());
  const out = 'C:/Users/ROOMIN~1/AppData/Local/Temp/claude/c--Users-Room-Innovation-OneDrive---room-innovation-com-Documents-Project-IRPC-BARCODE-FE-PWA-FL/0c54b900-a130-4b07-a8db-dafac3cc2f33/scratchpad';
  await page.screenshot({ path: out + '/probe1-initial.png' });
  await browser.close();
})();
