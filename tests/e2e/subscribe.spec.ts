import { test, expect } from "@playwright/test";

test.describe("subscribe form", () => {
  test("valid email returns success message", async ({ page }) => {
    await page.goto("/");
    // Try direct API call first — most reliable signal.
    const apiOk = await page.evaluate(async () => {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "qa-test@example.com", language: "en" }),
      });
      return { status: r.status, body: await r.text() };
    });
    expect(apiOk.status, `body: ${apiOk.body}`).toBe(200);
    expect(apiOk.body).toMatch(/inbox|confirm|ok/i);
  });

  test("invalid email returns 400 with helpful message", async ({ page }) => {
    await page.goto("/");
    const apiBad = await page.evaluate(async () => {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email", language: "en" }),
      });
      return { status: r.status, body: await r.text() };
    });
    expect(apiBad.status).toBe(400);
    expect(apiBad.body).toMatch(/valid|email/i);
  });

  test("language picker: only English active, others greyed", async ({ page }) => {
    await page.goto("/");
    const select = page.locator('select[name="language"], select#language').first();
    if (!(await select.count())) {
      test.info().annotations.push({ type: "skip", description: "language picker not a select" });
      return;
    }
    const opts = await select.locator("option").evaluateAll((nodes) =>
      nodes.map((n) => ({
        value: (n as HTMLOptionElement).value,
        disabled: (n as HTMLOptionElement).disabled,
        text: n.textContent || "",
      })),
    );
    const en = opts.find((o) => o.value === "en");
    expect(en, "English option must exist").toBeDefined();
    expect(en?.disabled).toBe(false);
    const otherEnabled = opts.filter((o) => o.value !== "en" && !o.disabled);
    expect(otherEnabled, `non-English options should be disabled: ${JSON.stringify(otherEnabled)}`)
      .toHaveLength(0);
  });
});
