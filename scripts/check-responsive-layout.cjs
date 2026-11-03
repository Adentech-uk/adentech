const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("file://" + path.resolve(__dirname, "../about.html"));
    const widths = [320, 340, 360, 375, 390, 414, 430, 600, 700, 701, 768, 820, 900, 901, 1024, 1280, 1440, 1920];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const values = document.querySelector(".values .grid");
        const commitments = document.querySelector(".commitments");
        const cards = [...document.querySelectorAll(".values .card, .commitments .card")];
        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          valuesColumns: getComputedStyle(values).gridTemplateColumns.split(" ").length,
          commitmentColumns: getComputedStyle(commitments).gridTemplateColumns.split(" ").length,
          cards: cards.map(card => {
            const rect = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            return {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              paddingLeft: parseFloat(style.paddingLeft),
              textWidth: card.querySelector("p").getBoundingClientRect().width,
              textHeight: card.querySelector("p").getBoundingClientRect().height
            };
          })
        };
      });
      assert.equal(layout.documentWidth, width, `Horizontal overflow at ${width}px: ${layout.documentWidth}px`);
      assert.equal(layout.valuesColumns, width <= 700 ? 1 : 2, `Unexpected values columns at ${width}px`);
      assert.equal(layout.commitmentColumns, width <= 700 ? 1 : width <= 900 ? 2 : 3, `Unexpected commitments columns at ${width}px`);
      for (const card of layout.cards) {
        assert.ok(card.width > 0, `Card has no width at ${width}px`);
        assert.ok(card.left >= -1 && card.right <= width + 1, `Card escapes viewport at ${width}px`);
        assert.ok(card.textWidth > 0 && card.textHeight > 0, `Card text is not laid out at ${width}px`);
      }
      console.log(`PASS ${width}px: values ${layout.valuesColumns} col, commitments ${layout.commitmentColumns} col, no overflow`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
