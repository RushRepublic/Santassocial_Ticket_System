import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const widths = [320, 360, 375, 390, 414, 430, 768, 1024, 1440, 1920];
const results = [];
const audited = new Set();
const output = "test-results/responsive-ui";
const axePath =
  process.env.AXE_PATH ||
  join(
    process.env.TEMP || "/tmp",
    "santa-ui-qa-tools/node_modules/axe-core/axe.min.js",
  );

// Opt-in extension of the existing isolated browser workflow. No fixtures or
// test-only endpoints are added to application code or production requests.
export async function auditResponsive(page, screen) {
  if (process.env.QA_RESPONSIVE !== "1") return;
  if (audited.has(screen)) return;
  audited.add(screen);
  mkdirSync(output, { recursive: true });
  const viewport = page.viewportSize();
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const measurements = await page.evaluate(() => {
        const visible = (node) =>
          node.getClientRects().length &&
          getComputedStyle(node).visibility !== "hidden";
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          smallInputs: [
            ...document.querySelectorAll(
              'input:not([type="checkbox"]), select, textarea',
            ),
          ]
            .filter(visible)
            .filter((node) => parseFloat(getComputedStyle(node).fontSize) < 16)
            .map((node) => node.id || node.name || node.tagName),
          smallControls: [
            ...document.querySelectorAll(
              ".button, .quantity-control button, .mobile-verify-button, .menu-button, .scanner-app > header button",
            ),
          ]
            .filter(visible)
            .filter(
              (node) =>
                !node.disabled && node.getBoundingClientRect().height < 43,
            )
            .map(
              (node) =>
                node.textContent.trim() || node.getAttribute("aria-label"),
            ),
        };
      });
      if (
        measurements.overflow ||
        measurements.smallInputs.length ||
        measurements.smallControls.length
      )
        throw Error(`${screen} at ${width}px: ${JSON.stringify(measurements)}`);
      let violations = [];
      if ([320, 1440].includes(width)) {
        if (!existsSync(axePath))
          throw Error(
            "Set AXE_PATH to axe-core/axe.min.js for the accessibility audit.",
          );
        await page.addScriptTag({ path: axePath });
        violations = await page.evaluate(async () => {
          const report = await window.axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
            },
          });
          return report.violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            elements: nodes.map(({ target, failureSummary }) => ({
              target,
              failureSummary,
            })),
          }));
        });
        await page.screenshot({
          path: `${output}/${screen}-${width}.png`,
          fullPage: true,
        });
      }
      results.push({ screen, width, ...measurements, violations });
      writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
      if (violations.length)
        console.warn(
          `${screen} accessibility findings: ${JSON.stringify(violations)}`,
        );
    }
    // A 768px viewport at 200% browser zoom has a 384 CSS-pixel layout.
    // CSS `zoom` alone does not update media queries, so test the equivalent
    // layout viewport instead of confusing it with native browser zoom.
    await page.setViewportSize({ width: 384, height: 450 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error(
        `${screen} overflows at the 200%-equivalent reflow viewport.`,
      );
    results.push({
      screen,
      zoom: "200%-equivalent reflow (768 to 384 CSS pixels)",
      overflow: false,
    });
    if (screen === "registration") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (
        await page.evaluate(
          () =>
            getComputedStyle(document.documentElement).scrollBehavior !==
            "auto",
        )
      )
        throw Error("Reduced-motion preference must disable smooth scrolling.");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const menu = page.getByRole("button", { name: "Open menu", exact: true });
      await menu.focus();
      await page.keyboard.press("Enter");
      if (
        (await page
          .getByRole("button", { name: "Close menu", exact: true })
          .getAttribute("aria-expanded")) !== "true"
      )
        throw Error(
          "Customer menu must expose its expanded state to keyboard users.",
        );
      await page
        .getByRole("link", { name: "Find my ticket", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Close menu", exact: true })
        .click();
      results.push({ screen, reducedMotion: "passed", keyboardMenu: "passed" });
    }
    writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
    console.log(
      `Responsive checks completed: ${screen}, ${widths.join(", ")}px and 200%-equivalent reflow`,
    );
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(({ x, y }) => scrollTo(x, y), scroll);
  }
}

export function assertResponsiveAudits() {
  const findings = results.filter((result) => result.violations?.length);
  if (findings.length)
    throw Error(
      `Accessibility findings remain; see ${output}/results.json (${findings.length} screen/width combinations).`,
    );
}
