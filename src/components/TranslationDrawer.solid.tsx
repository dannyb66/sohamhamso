/**
 * TranslationDrawer — Solid island. Multi-select translation picker that
 * stacks rendered translations line-by-line under the verse.
 *
 * Pattern: Vedabase-style swipe-up drawer. Floating 🌐 button bottom-right
 * (mobile) / right-rail (desktop ≥1024px). 11 supported langs as chips —
 * available chips are tappable; unavailable chips greyed with honest
 * "Not yet translated to {Lang}" empty state.
 *
 * Wiring (in verse page):
 *
 *   <script is:inline set:html={`window.__translations = ${JSON.stringify(payload)};`} />
 *   <TranslationDrawer client:idle />
 *
 * Where payload is an array of {lang, translator, translation_text,
 * judge_score, ai_assisted, status, model} from getVerseTranslations().
 *
 * Selected langs persist in localStorage under `sohamhamso:translation-langs`.
 * Default is ['en'].
 *
 * On selection change, dispatches `sohamhamso:translations-changed` with
 * detail {selected: string[]} so the verse page (or VerseAnatomy) can
 * react if it wants inline updates.
 *
 * A11y: role="dialog", aria-modal, ESC/scrim/handle dismiss, focus-trap,
 * focus-restore, 44px tap targets, prefers-reduced-motion collapses
 * transitions.
 *
 * Z-index: 65 (scrim) / 66 (sheet) — between WordSheet (60/61) and
 * SettingsSheet (70/71).
 */
import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js";

// ─── Language registry ────────────────────────────────────────────────
// Order matches V1 spec: English, Hindi, Bengali, Tamil, Telugu, Marathi,
// Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese.
const LANGS: Array<{ code: string; native: string; latin: string }> = [
  { code: "en", native: "English", latin: "English" },
  { code: "hi", native: "हिन्दी", latin: "Hindi" },
  { code: "bn", native: "বাংলা", latin: "Bengali" },
  { code: "ta", native: "தமிழ்", latin: "Tamil" },
  { code: "te", native: "తెలుగు", latin: "Telugu" },
  { code: "mr", native: "मराठी", latin: "Marathi" },
  { code: "gu", native: "ગુજરાતી", latin: "Gujarati" },
  { code: "kn", native: "ಕನ್ನಡ", latin: "Kannada" },
  { code: "ml", native: "മലയാളം", latin: "Malayalam" },
  { code: "pa", native: "ਪੰਜਾਬੀ", latin: "Punjabi" },
  { code: "or", native: "ଓଡ଼ିଆ", latin: "Odia" },
  { code: "as", native: "অসমীয়া", latin: "Assamese" },
];

interface TranslationRow {
  lang: string;
  translator: string | null;
  translation_text: string;
  judge_score: number | null;
  ai_assisted: boolean;
  status: "draft" | "reviewed" | "published";
  model: string | null;
}

declare global {
  interface Window {
    __translations?: TranslationRow[];
  }
}

const STORAGE_KEY = "sohamhamso:translation-langs";
const DEFAULT_SELECTED = ["en"];

function loadSelected(): string[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_SELECTED];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_SELECTED];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SELECTED];
    const valid = parsed.filter(
      (c): c is string =>
        typeof c === "string" && LANGS.some((l) => l.code === c),
    );
    return valid.length > 0 ? valid : [...DEFAULT_SELECTED];
  } catch {
    return [...DEFAULT_SELECTED];
  }
}

function saveSelected(selected: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  } catch {
    /* ignore */
  }
  document.dispatchEvent(
    new CustomEvent("sohamhamso:translations-changed", {
      detail: { selected },
    }),
  );
}

function labelFor(code: string): string {
  const l = LANGS.find((x) => x.code === code);
  return l ? l.latin : code;
}

export default function TranslationDrawer() {
  const [open, setOpen] = createSignal(false);
  const [selected, setSelected] = createSignal<string[]>([...DEFAULT_SELECTED]);
  const [available, setAvailable] = createSignal<TranslationRow[]>([]);

  let sheetEl: HTMLDialogElement | undefined;
  const titleId = "translation-drawer-title";
  let lastFocused: HTMLElement | null = null;
  let touchStartY = 0;
  let touchDelta = 0;

  const availableLangs = createMemo(
    () => new Set(available().map((t) => t.lang)),
  );

  const translationFor = (code: string): TranslationRow | undefined =>
    available().find((t) => t.lang === code);

  const toggle = (code: string) => {
    const isAvailable = availableLangs().has(code);
    if (!isAvailable) return; // greyed chips are aria-disabled; ignore taps
    const cur = selected();
    const next = cur.includes(code)
      ? cur.filter((c) => c !== code)
      : [...cur, code];
    setSelected(next);
    saveSelected(next);
  };

  const openSheet = () => {
    lastFocused = (document.activeElement as HTMLElement | null) ?? null;
    setOpen(true);
    queueMicrotask(() => {
      sheetEl?.querySelector<HTMLElement>(
        'button:not([aria-disabled="true"]), [href], input, [tabindex]:not([tabindex="-1"])',
      )?.focus();
    });
  };

  const closeSheet = () => {
    setOpen(false);
    if (sheetEl) sheetEl.style.transform = "";
    queueMicrotask(() => lastFocused?.focus?.());
  };

  const handleKey = (e: KeyboardEvent) => {
    if (!open()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== "Tab" || !sheetEl) return;
    const focusables = sheetEl.querySelectorAll<HTMLElement>(
      'button:not([aria-disabled="true"]):not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Touch-drag dismiss (mobile only).
  const handleTouchStart = (e: TouchEvent) => {
    touchStartY = e.touches[0].clientY;
    touchDelta = 0;
  };
  const handleTouchMove = (e: TouchEvent) => {
    touchDelta = e.touches[0].clientY - touchStartY;
    if (touchDelta > 0 && sheetEl) {
      sheetEl.style.transform = `translateY(${touchDelta}px)`;
    }
  };
  const handleTouchEnd = () => {
    if (touchDelta > 80) closeSheet();
    else if (sheetEl) sheetEl.style.transform = "";
    touchDelta = 0;
  };

  onMount(() => {
    if (typeof document === "undefined") return;
    setAvailable(window.__translations ?? []);
    setSelected(loadSelected());
    document.addEventListener("keydown", handleKey);
  });

  onCleanup(() => {
    if (typeof document === "undefined") return;
    document.removeEventListener("keydown", handleKey);
  });

  return (
    <>
      {/* Floating trigger: bottom-right (mobile) / right-rail (desktop) */}
      <button
        type="button"
        class="td-trigger"
        aria-label="Open translation drawer"
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
        onClick={openSheet}
      >
        <span aria-hidden="true">🌐</span>
      </button>

      <Show when={open()}>
        <div class="td-scrim" onClick={closeSheet} aria-hidden="true" />
        <dialog
          open
          ref={sheetEl}
          class="td-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div class="td-handle" aria-hidden="true" />

          <header class="td-head">
            <h2 id={titleId}>Translations</h2>
            <button
              type="button"
              class="td-close"
              onClick={closeSheet}
              aria-label="Close translation drawer"
            >
              ×
            </button>
          </header>

          <div class="td-body">
            {/* Chip grid — 11 langs */}
            <div class="td-chips" role="group" aria-label="Select languages">
              <For each={LANGS}>
                {(l) => {
                  const isAvail = () => availableLangs().has(l.code);
                  const isSel = () => selected().includes(l.code);
                  return (
                    <button
                      type="button"
                      class="td-chip"
                      classList={{
                        "td-chip--selected": isSel() && isAvail(),
                        "td-chip--unavailable": !isAvail(),
                      }}
                      aria-pressed={isSel() && isAvail() ? "true" : "false"}
                      aria-disabled={isAvail() ? "false" : "true"}
                      title={
                        isAvail()
                          ? `${l.native} (${l.latin})`
                          : `Not yet translated to ${l.latin}`
                      }
                      onClick={() => toggle(l.code)}
                    >
                      <span class="td-chip-native" lang={l.code}>
                        {l.native}
                      </span>
                      <span class="td-chip-latin">{l.latin}</span>
                    </button>
                  );
                }}
              </For>
            </div>

            {/* Live preview — stacked translations */}
            <section class="td-preview" aria-label="Selected translations">
              <Show
                when={selected().length > 0}
                fallback={
                  <p class="td-preview-empty">
                    No languages selected — tap a chip above to stack a
                    translation under the verse.
                  </p>
                }
              >
                <For each={selected()}>
                  {(code) => {
                    const row = () => translationFor(code);
                    return (
                      <article class="td-line" lang={code}>
                        <header class="td-line-head">
                          <span class="td-line-label">{labelFor(code)}</span>
                          <Show when={row()?.ai_assisted}>
                            <span
                              class={`td-pill td-pill--${row()?.status === "reviewed" ? "emerald" : "amber"}`}
                            >
                              {row()?.status === "reviewed"
                                ? "AI · reviewed"
                                : "AI · not verified"}
                            </span>
                          </Show>
                          <Show when={row() && !row()?.ai_assisted}>
                            <span class="td-pill td-pill--slate">
                              {row()?.translator
                                ? `${row()?.translator} · PD`
                                : "PD"}
                            </span>
                          </Show>
                        </header>
                        <Show
                          when={row()?.translation_text}
                          fallback={
                            <p class="td-line-empty">
                              Not yet translated to {labelFor(code)} —{" "}
                              <a href="/contribute">
                                track progress ↗
                              </a>
                            </p>
                          }
                        >
                          <p class="td-line-text">
                            {row()?.translation_text}
                          </p>
                        </Show>
                      </article>
                    );
                  }}
                </For>
              </Show>
            </section>
          </div>

          <style>{`
            .td-trigger {
              position: fixed;
              right: var(--spacing-4);
              bottom: var(--spacing-4);
              width: 44px;
              height: 44px;
              border-radius: 999px;
              background: var(--color-surface);
              border: 1px solid var(--color-rule);
              box-shadow: 0 2px 8px rgba(0,0,0,0.12);
              font-size: 20px;
              line-height: 1;
              cursor: pointer;
              z-index: 50;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              color: var(--color-ink);
            }
            .td-trigger:hover {
              border-color: var(--color-ink-muted);
            }
            @media (min-width: 1024px) {
              .td-trigger {
                position: fixed;
                right: var(--spacing-6);
                top: 50%;
                bottom: auto;
                transform: translateY(-50%);
              }
            }
            .td-scrim {
              position: fixed;
              inset: 0;
              background: rgba(0,0,0,0.4);
              z-index: 65;
            }
            .td-sheet {
              position: fixed;
              left: 0;
              right: 0;
              bottom: 0;
              margin: 0;
              padding: 0;
              width: 100%;
              max-width: 100%;
              max-height: 70vh;
              background: var(--color-surface);
              color: var(--color-ink);
              border: 0;
              border-top: 1px solid var(--color-rule);
              border-radius: 16px 16px 0 0;
              z-index: 66;
              overflow-y: auto;
              touch-action: pan-y;
              transition: transform var(--motion-base) var(--easing-out);
            }
            @media (prefers-reduced-motion: reduce) {
              .td-sheet { transition: none; }
            }
            @media (min-width: 1024px) {
              .td-sheet {
                left: auto;
                right: 0;
                bottom: 0;
                top: 0;
                width: 420px;
                max-width: 420px;
                max-height: 100vh;
                border-radius: 16px 0 0 16px;
                border: 0;
                border-inline-start: 1px solid var(--color-rule);
              }
            }
            .td-handle {
              width: 32px;
              height: 4px;
              margin: 8px auto 0;
              background: var(--color-rule);
              border-radius: 999px;
            }
            @media (min-width: 1024px) {
              .td-handle { display: none; }
            }
            .td-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: var(--spacing-4);
              border-block-end: 1px solid var(--color-rule);
              position: sticky;
              top: 0;
              background: var(--color-surface);
              z-index: 1;
            }
            .td-head h2 {
              margin: 0;
              font-family: var(--font-chrome);
              font-size: var(--text-base);
              font-weight: 600;
            }
            .td-close {
              appearance: none;
              background: transparent;
              border: 0;
              font-size: 28px;
              line-height: 1;
              min-width: 44px;
              min-height: 44px;
              color: var(--color-ink-muted);
              cursor: pointer;
            }
            .td-body {
              padding: var(--spacing-4);
              display: grid;
              gap: var(--spacing-5);
            }
            .td-chips {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: var(--spacing-2);
            }
            @media (min-width: 480px) {
              .td-chips {
                grid-template-columns: repeat(3, 1fr);
              }
            }
            .td-chip {
              appearance: none;
              display: grid;
              gap: 2px;
              padding: 8px 10px;
              min-height: 44px;
              text-align: start;
              background: var(--color-bg);
              border: 1px solid var(--color-rule);
              border-radius: 8px;
              cursor: pointer;
              color: var(--color-ink);
              font-family: var(--font-chrome);
            }
            .td-chip:hover:not([aria-disabled="true"]) {
              border-color: var(--color-ink-muted);
            }
            .td-chip--selected {
              background: var(--color-ink);
              color: var(--color-surface);
              border-color: var(--color-ink);
            }
            .td-chip--selected .td-chip-latin {
              color: var(--color-surface);
              opacity: 0.75;
            }
            .td-chip--unavailable {
              opacity: 0.45;
              cursor: not-allowed;
              background: transparent;
            }
            .td-chip-native {
              font-size: var(--text-sm);
              line-height: 1.2;
            }
            .td-chip-latin {
              font-size: var(--text-xs);
              color: var(--color-ink-muted);
              line-height: 1.2;
            }
            .td-preview {
              display: grid;
              gap: var(--spacing-4);
              padding-top: var(--spacing-3);
              border-block-start: 1px solid var(--color-rule);
            }
            .td-preview-empty {
              margin: 0;
              font-family: var(--font-iast);
              font-size: var(--text-sm);
              color: var(--color-ink-muted);
            }
            .td-line {
              display: grid;
              gap: 6px;
            }
            .td-line-head {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: var(--spacing-2);
            }
            .td-line-label {
              font-family: var(--font-chrome);
              font-size: var(--text-xs);
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: var(--color-ink-muted);
            }
            .td-line-text {
              margin: 0;
              font-family: var(--font-iast);
              font-size: var(--text-md);
              line-height: 1.55;
              color: var(--color-ink);
            }
            .td-line-empty {
              margin: 0;
              font-family: var(--font-iast);
              font-style: italic;
              font-size: var(--text-sm);
              color: var(--color-ink-muted);
            }
            .td-pill {
              display: inline-flex;
              align-items: center;
              padding: 2px 8px;
              border-radius: 999px;
              border: 1px solid transparent;
              font-family: var(--font-chrome);
              font-size: 10px;
              font-weight: 500;
              line-height: 1.4;
            }
            .td-pill--amber {
              background: #FEF3C7;
              border-color: #FCD34D;
              color: #78350F;
            }
            .td-pill--emerald {
              background: #ECFDF5;
              border-color: #6EE7B7;
              color: #064E3B;
            }
            .td-pill--slate {
              background: #F1F5F9;
              border-color: #CBD5E1;
              color: #1E293B;
            }
            :root[data-theme="dark"] .td-pill--amber,
            :root[data-theme="oled"] .td-pill--amber {
              background: #3F2A0A;
              border-color: #B45309;
              color: #FCD34D;
            }
            :root[data-theme="dark"] .td-pill--emerald,
            :root[data-theme="oled"] .td-pill--emerald {
              background: #0F3B2A;
              border-color: #047857;
              color: #6EE7B7;
            }
            :root[data-theme="dark"] .td-pill--slate,
            :root[data-theme="oled"] .td-pill--slate {
              background: #1F2937;
              border-color: #475569;
              color: #CBD5E1;
            }
          `}</style>
        </dialog>
      </Show>

      {/* Trigger styles must live outside Show so the floating button
          is always present (not just when sheet is open). */}
      <style>{`
        .td-trigger {
          position: fixed;
          right: var(--spacing-4);
          bottom: var(--spacing-4);
          width: 44px;
          height: 44px;
          border-radius: 999px;
          background: var(--color-surface);
          border: 1px solid var(--color-rule);
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          z-index: 50;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--color-ink);
        }
        .td-trigger:hover {
          border-color: var(--color-ink-muted);
        }
        @media (min-width: 1024px) {
          .td-trigger {
            position: fixed;
            right: var(--spacing-6);
            top: 50%;
            bottom: auto;
            transform: translateY(-50%);
          }
        }
      `}</style>
    </>
  );
}
