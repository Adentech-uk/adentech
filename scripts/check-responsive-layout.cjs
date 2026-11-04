const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("file://" + path.resolve(__dirname, "../about.html"));
    const widths = [320, 340, 360, 375, 390, 414, 430, 600, 700, 701, 760, 768, 820, 900, 901, 1024, 1280, 1440, 1920];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const trustGrid = document.querySelector(".trust-grid");
        const cards = [...document.querySelectorAll(".trust-grid .card")];
        const gridStyle = trustGrid ? getComputedStyle(trustGrid) : null;

        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          trustColumns: gridStyle ? gridStyle.gridTemplateColumns.split(" ").length : 0,
          gridVisible: Boolean(trustGrid && gridStyle.display !== "none" && gridStyle.visibility !== "hidden"),
          cards: cards.map(card => {
            const rect = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            const paragraph = card.querySelector("p");
            const textRect = paragraph ? paragraph.getBoundingClientRect() : null;
            return {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0,
              text: paragraph ? paragraph.textContent.trim() : "",
              textWidth: textRect ? textRect.width : 0,
              textHeight: textRect ? textRect.height : 0
            };
          })
        };
      });

      assert.equal(layout.documentWidth, width, `Horizontal overflow at ${width}px: ${layout.documentWidth}px`);
      assert.equal(layout.gridVisible, true, `Trust-card grid is not visible at ${width}px`);
      assert.equal(layout.trustColumns, width <= 760 ? 1 : 3, `Unexpected trust-card columns at ${width}px`);
      assert.equal(layout.cards.length, 3, `Expected all three trust cards at ${width}px`);

      for (const card of layout.cards) {
        assert.ok(card.visible, `Card is hidden at ${width}px`);
        assert.ok(card.width > 0, `Card has no width at ${width}px`);
        assert.ok(card.left >= -1 && card.right <= width + 1, `Card escapes viewport at ${width}px`);
        assert.ok(card.text.length > 0, `Card text is missing at ${width}px`);
        assert.ok(card.textWidth > 0 && card.textHeight > 0, `Card text is not laid out at ${width}px`);
      }

      console.log(`PASS ${width}px: trust cards ${layout.trustColumns} col, all 3 visible, no overflow`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
