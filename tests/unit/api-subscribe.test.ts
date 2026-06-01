/**
 * Unit tests for `src/pages/api/subscribe.ts` POST handler.
 *
 * Strategy:
 *   - Import the Astro `POST` route handler directly.
 *   - Build a stub `APIContext` with a real `Request` carrying a JSON body.
 *   - Call `POST({ request })` and assert on the Response status + JSON body.
 *
 * No network. No Astro runtime. Pure-function shape: (ctx) → Response.
 *
 * Run with: `bun --bun vitest run tests/unit/api-subscribe.test.ts`
 */
import { describe, expect, it } from "vitest";
import { POST } from "../../src/pages/api/subscribe";

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Astro's APIContext is rich; the handler only reads `request`. Cast through
// `unknown` so we don't have to construct the rest of the context shape.
function call(req: Request): Promise<Response> {
  return Promise.resolve(POST({ request: req } as unknown as Parameters<typeof POST>[0]));
}

describe("POST /api/subscribe", () => {
  it("returns 200 + ok:true for a valid email + default language", async () => {
    const res = await call(jsonReq({ email: "danny@example.com" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/inbox/i);
    expect(body.message).toMatch(/confirm/i);
  });

  it("returns 200 + ok:true when language is explicitly 'en'", async () => {
    const res = await call(jsonReq({ email: "danny@example.com", language: "en" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 400 + helpful message when email is missing", async () => {
    const res = await call(jsonReq({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBe("Please enter a valid email address.");
  });

  it("returns 400 + helpful message when email is empty string", async () => {
    const res = await call(jsonReq({ email: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/valid email/i);
  });

  it("returns 400 for a malformed email (no @)", async () => {
    const res = await call(jsonReq({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/valid email/i);
  });

  it("returns 400 for a malformed email (no TLD)", async () => {
    const res = await call(jsonReq({ email: "danny@localhost" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns 400 for an unknown language code", async () => {
    const res = await call(jsonReq({ email: "danny@example.com", language: "klingon" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/unknown language/i);
  });

  it("returns 400 for a known-but-inactive language (e.g., 'hi') with the V1 message", async () => {
    const res = await call(jsonReq({ email: "danny@example.com", language: "hi" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    // V1: only English is active. Other queued langs are rejected with a
    // soft "not yet available" copy.
    expect(body.message).toMatch(/yet|english|roll out/i);
  });

  it("returns Content-Type application/json", async () => {
    const res = await call(jsonReq({ email: "danny@example.com" }));
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/i);
  });

  it("accepts form-encoded bodies (no-JS fallback path)", async () => {
    const form = new URLSearchParams({ email: "danny@example.com", language: "en" });
    const req = new Request("http://localhost/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const res = await call(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
