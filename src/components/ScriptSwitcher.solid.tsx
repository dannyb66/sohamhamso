// @ts-ignore — Sanscript ships untyped (CJS). The .t signature is stable.
import Sanscript from '@indic-transliteration/sanscript';
/**
 * ScriptSwitcher — Solid island for switching the rendered script of every
 * Sanskrit-bearing element on the page (`[data-sa]`).
 *
 * Pattern: top-bar button shows the current script name; tap opens a bottom
 * sheet listing 11 scripts. On selection, every `[data-sa]` element is
 * re-rendered via Sanscript.t(source, 'devanagari', target). Source text is
 * preserved on `data-sa-source` so repeated switches don't compound errors.
 *
 * State persists in localStorage under `sohamhamso:script`.
 *
 * Locked anti-pattern: NEVER reload the page on script change — pure DOM swap.
 */
import { For, Show, createSignal, onMount } from 'solid-js';

interface ScriptOption {
  /** Sanscript scheme id */
  id: string;
  /** UI label */
  label: string;
  /** A sample word in that script for the chooser row */
  sample: string;
}

// The 11 scripts the project ships. `devanagari` is the source — listed
// first so the switcher can return to source losslessly.
const SCRIPTS: ScriptOption[] = [
  { id: 'devanagari', label: 'Devanāgarī', sample: 'देवनागरी' },
  { id: 'iast', label: 'IAST (Latin)', sample: 'devanāgarī' },
  { id: 'bengali', label: 'Bengali / Bāṅlā', sample: 'বাংলা' },
  { id: 'assamese', label: 'Assamese', sample: 'অসমীয়া' },
  { id: 'gujarati', label: 'Gujarati', sample: 'ગુજરાતી' },
  { id: 'gurmukhi', label: 'Gurmukhi', sample: 'ਗੁਰਮੁਖੀ' },
  { id: 'kannada', label: 'Kannada', sample: 'ಕನ್ನಡ' },
  { id: 'malayalam', label: 'Malayalam', sample: 'മലയാളം' },
  { id: 'oriya', label: 'Odia', sample: 'ଓଡ଼ିଆ' },
  { id: 'tamil', label: 'Tamil', sample: 'தமிழ்' },
  { id: 'telugu', label: 'Telugu', sample: 'తెలుగు' },
];

const STORAGE_KEY = 'sohamhamso:script';

/**
 * Re-render every `[data-sa]` element on the page from its preserved
 * source Devanāgarī string into the target script.
 */
function applyScript(target: string) {
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll<HTMLElement>('[data-sa]');
  for (const el of nodes) {
    const src = el.dataset.saSource ?? el.textContent ?? '';
    // Preserve source on first run so repeated switches stay lossless.
    if (!el.dataset.saSource) el.dataset.saSource = src;
    try {
      el.textContent = Sanscript.t(src, 'devanagari', target);
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
  const [current, setCurrent] = createSignal('devanagari');
  const [open, setOpen] = createSignal(false);

  onMount(() => {
    // Restore persisted choice.
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SCRIPTS.some((s) => s.id === saved)) {
        setCurrent(saved);
        if (saved !== 'devanagari') applyScript(saved);
      }
    } catch {
      // localStorage unavailable (private mode / SSR) — ignore.
    }
  });

  const select = (id: string) => {
    setCurrent(id);
    applyScript(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const currentLabel = () => SCRIPTS.find((s) => s.id === current())?.label ?? 'Devanāgarī';

  return (
    <div class="script-switcher">
      <button
        type="button"
        class="script-switcher__trigger"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label={`Script: ${currentLabel()} — tap to change`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">अ</span>
        <span class="script-switcher__label">{currentLabel()}</span>
      </button>

      <Show when={open()}>
        <div class="script-switcher__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
        <dialog open class="script-switcher__sheet" aria-label="Choose script">
          <header class="script-switcher__head">
            <h2>Script</h2>
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
            <For each={SCRIPTS}>
              {(s) => (
                <li>
                  <button
                    type="button"
                    class="script-switcher__row"
                    aria-current={current() === s.id ? 'true' : 'false'}
                    onClick={() => select(s.id)}
                  >
                    <span class="script-switcher__sample">{s.sample}</span>
                    <span class="script-switcher__name">{s.label}</span>
                    {current() === s.id ? (
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
