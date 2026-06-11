/**
 * ScriptSwitcher — Solid island for switching the active "reading mode"
 * on a verse page. A reading mode bundles (a) the script the Sanskrit
 * line is transliterated INTO, and (b) the language glosses + the
 * primary translation are rendered IN.
 *
 * Pattern: top-bar button shows the current reading mode's English name;
 * tap opens a bottom sheet listing the 12 modes from the shared
 * READING_MODES catalogue (src/lib/reading-modes.ts). On selection,
 * applyReadingMode() persists both localStorage keys + dispatches
 * sohamhamso:reader-lang-change, and applyScript() re-renders every
 * `[data-sa]` element via Sanscript.t(source, 'devanagari', target).
 * Source text is preserved on `data-sa-source` so repeated switches
 * stay lossless.
 *
 * State is restored from localStorage['sohamhamso:reader-lang'] (NOT
 * 'sohamhamso:script') because the catalogue is lang-keyed — Hindi and
 * Marathi share Devanāgarī but are distinct rows.
 *
 * Locked anti-pattern: NEVER reload the page on a pick — pure DOM swap.
 */
import { For, Show, createSignal, onMount } from 'solid-js';
import {
  type LangCode,
  READING_MODES,
  applyReadingMode,
  getReadingModeByLang,
} from '../lib/reading-modes';

/**
 * Sanscript is ~26 KB minified — the largest single chunk in the
 * ScriptSwitcher island. Devanāgarī mode is the default and needs zero
 * transliteration (lines are SSR'd in Devanāgarī already), so most
 * first-paints don't need this code at all.
 *
 * Lazy-load it the first time we need to transliterate, and memoize the
 * promise so subsequent script switches don't re-import. Restoring a
 * non-default saved reading-mode at onMount also goes through this path —
 * Devanāgarī paints first, then swaps after the Sanscript chunk arrives
 * (single-digit ms after hydrate on warm cache).
 */
type SanscriptModule = { default: { t: (src: string, from: string, to: string) => string } };
let sanscriptPromise: Promise<SanscriptModule> | null = null;
function loadSanscript(): Promise<SanscriptModule> {
  if (!sanscriptPromise) {
    // @ts-ignore — Sanscript ships untyped (CJS). The .t signature is stable.
    sanscriptPromise = import('@indic-transliteration/sanscript') as Promise<SanscriptModule>;
  }
  return sanscriptPromise;
}

/**
 * Re-render every `[data-sa]` element on the page from its preserved
 * source Devanāgarī string into the target script.
 *
 * Design contract (per user spec 2026-06-01):
 *   - Line 1 `.verse-devanagari` carries NO `data-sa` — it stays in
 *     Devanāgarī always. The Sanskrit original is never transliterated
 *     away from its source script.
 *   - Line 2 `.verse-iast`, lemma `.sa-word` buttons, and any other
 *     `[data-sa]` elements get the "effective" target script:
 *       devanagari → iast    (Devanāgarī mode = IAST transliteration line + IAST lemmas)
 *       iast       → iast
 *       <other>    → <other>
 *     This way Devanāgarī mode reads as the Vedabase scholar view
 *     (Devanāgarī verse + IAST below), and Indic modes read as
 *     "Devanāgarī + transliteration into that Indic script."
 */
async function applyScript(target: string) {
  if (typeof document === 'undefined') return;
  const effective = target === 'devanagari' ? 'iast' : target;
  const { default: Sanscript } = await loadSanscript();
  const nodes = document.querySelectorAll<HTMLElement>('[data-sa]');
  for (const el of nodes) {
    const src = el.dataset.saSource ?? el.textContent ?? '';
    // Preserve source on first run so repeated switches stay lossless.
    if (!el.dataset.saSource) el.dataset.saSource = src;
    try {
      el.textContent = Sanscript.t(src, 'devanagari', effective);
    } catch {
      // Fall back to source on any transliteration failure (e.g.,
      // unmapped Vedic glyph). Keep the source visible rather than
      // showing empty content.
      el.textContent = src;
    }
  }
  // Toggle a root attr so other components (e.g., lang tags) can react.
  document.documentElement.dataset.saScript = target;
}

export default function ScriptSwitcher() {
  // `current` is a langCode — the catalogue is lang-keyed because
  // Hindi + Marathi both ride Devanāgarī but are distinct reading modes.
  const [current, setCurrent] = createSignal<LangCode>('en');
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    // Restore from the dedicated reader-lang key. Fall back to the
    // legacy script key when no lang was ever set (first-time visitors
    // upgrading from the pre-catalogue build).
    //
    // `applyScript` is async (lazy-imports Sanscript). We `void` the
    // promise so onMount returns synchronously and Solid's hydrate isn't
    // blocked; the swap fires when the chunk lands.
    try {
      const savedLang = localStorage.getItem('sohamhamso:reader-lang');
      if (savedLang) {
        const mode = getReadingModeByLang(savedLang);
        if (mode) {
          setCurrent(mode.langCode);
          if (mode.scriptId !== 'devanagari') void applyScript(mode.scriptId);
          return;
        }
      }
      const savedScript = localStorage.getItem('sohamhamso:script');
      if (savedScript) {
        // Best-effort back-fill: pick the first matching catalogue row.
        const mode = READING_MODES.find((m) => m.scriptId === savedScript);
        if (mode) {
          setCurrent(mode.langCode);
          if (mode.scriptId !== 'devanagari') void applyScript(mode.scriptId);
        }
      }
    } catch {
      // localStorage unavailable (private mode / SSR) — ignore.
    }
  });

  const select = (langCode: LangCode) => {
    const mode = getReadingModeByLang(langCode);
    if (!mode) return;
    setCurrent(mode.langCode);
    void applyScript(mode.scriptId);
    // applyReadingMode handles both localStorage keys + the
    // reader-lang-change CustomEvent, so ReaderLangSwap reacts in the
    // same tick.
    applyReadingMode(mode.langCode);
    setOpen(false);
  };

  const currentMode = () => getReadingModeByLang(current()) ?? READING_MODES[0];
  const currentLabel = () => currentMode().englishName;

  return (
    <div class="script-switcher">
      <button
        type="button"
        class="script-switcher__trigger"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label={`Translation language: ${currentLabel()} — tap to change`}
        onClick={() => setOpen((v) => !v)}
      >
        {/*
          अ Devanāgarī glyph removed per audit-2026-06-01 rec #18: the
          catalogue (src/lib/reading-modes.ts) binds language + script in
          one motion, but the user-load-bearing axis is the language. The
          glyph signalled "script picker" and misled users. Trigger now
          reads as a plain language label, matching the Masthead chip and
          the TranslationDrawer sheet title.
        */}
        <span class="script-switcher__label">{currentLabel()}</span>
      </button>

      <Show when={open()}>
        <div class="script-switcher__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
        <dialog open class="script-switcher__sheet" aria-label="Translation language">
          <header class="script-switcher__head">
            <h2>Translation language</h2>
            <button
              type="button"
              class="script-switcher__close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <ul class="script-switcher__list">
            <For each={READING_MODES}>
              {(m) => (
                <li>
                  <button
                    type="button"
                    class="script-switcher__row"
                    aria-current={current() === m.langCode ? 'true' : 'false'}
                    onClick={() => select(m.langCode)}
                  >
                    <span class="script-switcher__sample">{m.nativeLabel}</span>
                    <span class="script-switcher__name">{m.englishName}</span>
                    {current() === m.langCode ? (
                      <span class="script-switcher__check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </dialog>
      </Show>

      <style>{`
        .script-switcher__trigger {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          min-height: 44px;
          background: transparent;
          border: 1px solid var(--color-rule);
          border-radius: 999px;
          color: var(--color-ink);
          font-family: var(--font-chrome);
          font-size: var(--text-sm);
          cursor: pointer;
        }
        .script-switcher__trigger:hover {
          border-color: var(--color-ink-muted);
        }
        .script-switcher__label {
          font-weight: 500;
        }
        .script-switcher__scrim {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          z-index: 50;
        }
        .script-switcher__sheet {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          margin: 0;
          padding: 0;
          max-width: 100%;
          width: 100%;
          max-height: 70vh;
          background: var(--color-surface);
          color: var(--color-ink);
          border: 0;
          border-top: 1px solid var(--color-rule);
          border-radius: 16px 16px 0 0;
          z-index: 51;
          overflow-y: auto;
        }
        @media (min-width: 768px) {
          .script-switcher__sheet {
            left: 50%;
            right: auto;
            bottom: auto;
            top: 80px;
            transform: translateX(-50%);
            width: 380px;
            max-height: 80vh;
            border-radius: 12px;
            border: 1px solid var(--color-rule);
          }
        }
        .script-switcher__head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--spacing-4);
          border-block-end: 1px solid var(--color-rule);
        }
        .script-switcher__head h2 {
          margin: 0;
          font-family: var(--font-chrome);
          font-size: var(--text-base);
          font-weight: 600;
        }
        .script-switcher__close {
          appearance: none;
          background: transparent;
          border: 0;
          font-size: 24px;
          line-height: 1;
          min-width: 44px;
          min-height: 44px;
          color: var(--color-ink-muted);
          cursor: pointer;
        }
        .script-switcher__list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .script-switcher__row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: var(--spacing-4);
          padding: var(--spacing-3) var(--spacing-4);
          min-height: 56px;
          background: transparent;
          border: 0;
          border-block-end: 1px solid var(--color-rule);
          color: var(--color-ink);
          font-family: var(--font-chrome);
          font-size: var(--text-sm);
          text-align: left;
          cursor: pointer;
        }
        .script-switcher__row:hover,
        .script-switcher__row:focus-visible {
          background: var(--color-bg);
        }
        .script-switcher__row[aria-current="true"] {
          color: var(--color-accent);
        }
        .script-switcher__sample {
          font-size: var(--text-md);
          min-width: 80px;
        }
        .script-switcher__name {
          flex: 1;
        }
        .script-switcher__check {
          color: var(--color-accent);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
