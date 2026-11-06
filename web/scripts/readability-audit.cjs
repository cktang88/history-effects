#!/usr/bin/env node
// Readability audit: drives the running app (web on :5173, server on :3000;
// `MOCK_LLM=1` for the AI flows) through every view and fails if any text is
//   - smaller than 12px as actually rendered (canvas zoom included),
//   - cut off (overflow, ellipsis, line clamp, hidden-scrollbar scrollers), or
//   - covered by another element of the same component (e.g. a badge).
// Usage: node web/scripts/readability-audit.cjs   (uses the preinstalled Playwright)
const { chromium } = require('playwright');
const MIN = Number(process.env.MIN_PX || 12);

async function audit(p, label) {
  const res = await p.evaluate((MIN) => {
    const zoomOf = (el) => {
      const vp = el.closest('.react-flow__viewport');
      if (!vp) return 1;
      const m = new DOMMatrix(getComputedStyle(vp).transform);
      return m.a || 1;
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const small = new Map(), cut = new Map();
    const name = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase());
    for (const el of document.querySelectorAll('body *')) {
      if (['SCRIPT', 'STYLE', 'svg', 'path', 'line', 'marker', 'defs', 'OPTION', 'DATALIST'].includes(el.tagName)) continue;
      if (el.closest('[id^="react-flow__node-desc"], [id^="react-flow__edge-desc"], .react-flow__a11y-description, [style*="display: none"]')) continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!ownText || !visible(el)) continue;
      const cs = getComputedStyle(el);
      // Actual rendered scale (canvas zoom and any own transform), measured.
      const inCanvas = !!el.closest('.react-flow__viewport, .react-flow__edgelabel-renderer');
      // Measure scale on a wide host (card/tooltip): integer layout widths make
      // the ratio inaccurate on tiny elements like a one-digit badge.
      const host = el.closest('.card, .edge-tip') || el;
      const scale = inCanvas && host.offsetWidth > 0 ? host.getBoundingClientRect().width / host.offsetWidth : 1;
      const eff = parseFloat(cs.fontSize) * scale;
      if (eff < MIN - 0.01) {
        const k = name(el); const v = small.get(k) || { n: 0, px: eff, ex: el.textContent.trim().slice(0, 40) }; v.n++; v.px = Math.min(v.px, eff); small.set(k, v);
      }
    }
    for (const el of document.querySelectorAll('body *')) {
      const ownText2 = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      const isScroller = getComputedStyle(el).scrollbarWidth === 'none';
      if ((!ownText2 && !isScroller) || !visible(el) || el.closest('.react-flow__a11y-description, [id^="react-flow__node-desc"], [id^="react-flow__edge-desc"]')) continue;
      const cs = getComputedStyle(el);
      const clips = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
      const hiddenScroll = cs.scrollbarWidth === 'none' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
      if (hiddenScroll) { const k = name(el) + ' (hidden scrollbar)'; cut.set(k, { n: 1, ex: el.textContent.trim().slice(0, 60) }); continue; }
      if (!clips || ['auto', 'scroll'].includes(cs.overflowY) || ['auto', 'scroll'].includes(cs.overflowX)) continue;
      if (el.tagName === 'INPUT') continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        const k = name(el); const v = cut.get(k) || { n: 0, ex: el.textContent.trim().slice(0, 60) }; v.n++; cut.set(k, v);
      }
    }
    // Occlusion: text covered by another element of the same component
    // (e.g. a badge over a title). Panels legitimately covering the canvas
    // don't count.
    const covered = new Map();
    const COMPONENT = '.card, .panel, .atlas, .topbar, .toolbar, .hud, .legend, .help, .toast, .suggest, .edge-tip, .empty-inner';
    for (const el of document.querySelectorAll('body *')) {
      const textNodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!textNodes.length || !visible(el)) continue;
      const comp = el.closest(COMPONENT);
      if (!comp) continue;
      for (const tn of textNodes) {
        const range = document.createRange(); range.selectNodeContents(tn);
        for (const r of range.getClientRects()) {
          for (const fx of [0.04, 0.5, 0.96]) {
            const x = r.left + r.width * fx, y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            // Content scrolled outside its scroll container is clipped, not covered.
            let sc = el.parentElement, clipped = false;
            while (sc) {
              const o = getComputedStyle(sc).overflowY;
              if (o === 'auto' || o === 'scroll') { const rr = sc.getBoundingClientRect(); if (y < rr.top + 1 || y > rr.bottom - 1) clipped = true; break; }
              sc = sc.parentElement;
            }
            if (clipped) continue;
            const top = document.elementFromPoint(x, y);
            if (!top || el.contains(top) || top.contains(el)) continue;
            if (!comp.contains(top)) continue;
            if (top.closest('.suggest, .edge-tip, .legend-body, .help-backdrop')) continue; // intentional popovers
            const k = name(el) + ' under ' + name(top); const v = covered.get(k) || { n: 0, ex: tn.textContent.trim().slice(0, 40) }; v.n++; covered.set(k, v);
          }
        }
      }
    }
    for (const [k, v] of covered) cut.set('COVERED ' + k, v);
    return { small: [...small], cut: [...cut] };
  }, MIN);
  console.log(`\n### ${label}`);
  for (const [k, v] of res.small) console.log(`  SMALL ${k} ×${v.n} min ${v.px.toFixed(1)}px  "${v.ex}"`);
  for (const [k, v] of res.cut) console.log(`  CUT   ${k} ×${v.n}  "${v.ex}"`);
  if (!res.small.length && !res.cut.length) console.log('  ok');
  return res.small.length + res.cut.length;
}

(async () => {
  const b = await chromium.launch();
  let issues = 0;
  for (const vp of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
    const p = await b.newPage({ viewport: vp });
    await p.goto('http://localhost:5173'); await p.waitForTimeout(900);
    issues += await audit(p, `${vp.name}: landing`);
    await p.fill('#search-input', 'revolution'); await p.waitForTimeout(600);
    issues += await audit(p, `${vp.name}: suggestions`);
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
    issues += await audit(p, `${vp.name}: entity opened (auto zoom)`);
    await p.locator('.link-row-why').first().click(); await p.waitForTimeout(1200);
    issues += await audit(p, `${vp.name}: link panel`);
    await p.keyboard.press('Escape');
    if (vp.name === 'desktop') {
      await p.click('.search-modes button:has-text("Connect")');
      await p.fill('.search-pair input >> nth=0', 'Treaty of Versailles'); await p.fill('.search-pair input >> nth=1', 'Cold War');
      await p.click('.search-go'); await p.waitForTimeout(2500);
      issues += await audit(p, `${vp.name}: story panel`);
      await p.keyboard.press('Escape');
      await p.click('.search-modes button:has-text("Explore")');
      for (const z of [1, 0.7, 0.5]) {
        await p.evaluate((z) => { const vp = document.querySelector('.react-flow__viewport'); }, z);
        await p.keyboard.press('f'); await p.waitForTimeout(900);
      }
      issues += await audit(p, `${vp.name}: fit all`);
      await p.click('.legend-toggle'); await p.waitForTimeout(300);
      issues += await audit(p, `${vp.name}: legend`);
      await p.click('.legend-toggle');
      await p.keyboard.press('?'); await p.waitForTimeout(300);
      issues += await audit(p, `${vp.name}: help`);
      await p.keyboard.press('Escape'); await p.keyboard.press('?');
    }
    await p.click('.atlas-toggle'); await p.waitForTimeout(1500);
    issues += await audit(p, `${vp.name}: atlas`);
    await p.fill('#search-input', 'zzqx imaginary event').catch(() => {}); 
    await p.close();
  }
    {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:5173'); await p.waitForTimeout(800);
  await p.fill('#search-input', 'zzqx imaginary event'); await p.keyboard.press('Enter');
  await p.waitForTimeout(700);
  issues += await audit(p, 'AI explore streaming (HUD + skeleton)');
  await p.waitForTimeout(4000);
  issues += await audit(p, 'AI explore done (long AI descriptions)');
  await p.locator('.card').nth(2).click(); await p.waitForTimeout(500);
  await p.locator('.link-row-why').first().click(); await p.waitForTimeout(600);
  await p.click('text=Explain this connection in depth'); await p.waitForTimeout(3500);
  issues += await audit(p, 'explanation panel');
  for (let i = 0; i < 12; i++) await p.click('.toolbar button[title^="Zoom out"]');
  await p.waitForTimeout(800);
  issues += await audit(p, 'zoomed fully out');
  for (let i = 0; i < 16; i++) await p.click('.toolbar button[title^="Zoom in"]');
  await p.waitForTimeout(800);
  issues += await audit(p, 'zoomed fully in');
  await p.screenshot({ path: '/tmp/claude-0/shots/u-zoomin.png' });
  await p.keyboard.press('Escape');
  await p.keyboard.press('f'); await p.waitForTimeout(900);
  await p.screenshot({ path: '/tmp/claude-0/shots/v-fit.png' });
  await p.keyboard.press('z'); await p.keyboard.press('z'); await p.keyboard.press('z'); await p.waitForTimeout(400);
  issues += await audit(p, 'toast');
      await p.close();
  }
  console.log(`\nTOTAL issue groups: ${issues}`);
  await b.close();
  process.exit(issues ? 1 : 0);
})();
