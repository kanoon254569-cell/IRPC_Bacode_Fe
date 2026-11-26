const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:4200/job-accept', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.click('mat-datepicker-toggle button');
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll('mat-form-field'));
    const dateField = fields[2]; // 3rd is Date
    const wrapper = dateField.querySelector('.mat-mdc-text-field-wrapper');
    const label = dateField.querySelector('label');
    const cs = getComputedStyle(wrapper);
    const fieldCs = getComputedStyle(dateField);
    return {
      fieldClass: dateField.className,
      fieldRect: dateField.getBoundingClientRect(),
      wrapperClass: wrapper ? wrapper.className : null,
      wrapperRect: wrapper ? wrapper.getBoundingClientRect() : null,
      wrapperBg: cs.backgroundColor,
      wrapperHeight: cs.height,
      wrapperOverflow: cs.overflow,
      labelExists: !!label,
      labelText: label ? label.textContent : null,
      labelRect: label ? label.getBoundingClientRect() : null,
      labelDisplay: label ? getComputedStyle(label).display : null,
      labelOpacity: label ? getComputedStyle(label).opacity : null,
      fieldMarginBottom: fieldCs.marginBottom,
      fieldFlexBasis: fieldCs.flexBasis,
      outerHTML: dateField.outerHTML.slice(0, 2000),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
