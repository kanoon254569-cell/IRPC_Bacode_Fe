const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:4200/job-accept', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  const out = 'C:/Users/ROOMIN~1/AppData/Local/Temp/claude/c--Users-Room-Innovation-OneDrive---room-innovation-com-Documents-Project-IRPC-BARCODE-FE-PWA-FL/0c54b900-a130-4b07-a8db-dafac3cc2f33/scratchpad';

  // click the datepicker toggle button
  await page.click('mat-datepicker-toggle button');
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/probe2-calendar-open.png' });

  // pick a day (e.g. the 11th) from the visible calendar
  const dayCell = page.locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)').filter({ hasText: /^11$/ }).first();
  await dayCell.click({ timeout: 5000 }).catch(async (e) => { console.log('day click fail', e.message); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + '/probe3-after-pick.png' });
})().catch(e => { console.error(e); process.exit(1); });
