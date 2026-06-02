/**
 * SettingsSheet — Solid island. Reading-controls bottom sheet (mobile) /
 * modal (desktop) for typography, theme, default translation language,
 * and default script. Triggered by any element dispatching the
 * `sohamhamso:open-settings` CustomEvent (e.g., the Masthead [Aa] button,
 * the verse-page top chrome).
 *
 * BaseLayout wiring (required) — add this once, after `<slot />` in
 *   src/layouts/BaseLayout.astro
 *
 *     ---
 *     import SettingsSheet from "../components/SettingsSheet.solid.tsx";
 *     ---
 *     ...
 *     <slot />
 *     <SettingsSheet client:idle />
 *
 * Trigger pattern (in any chrome button):
 *
 *     <button data-settings-trigger aria-label="Reading settings">Aa</button>
 *     <script>
 *       document.querySelector("[data-settings-trigger]")
 *         ?.addEventListener("click", () => {
 *           document.dispatchEvent(new CustomEvent("sohamhamso:open-settings"));
 *         });
 *     </script>
 *
 * Persistence: ALL settings live in localStorage under
 * `sohamhamso:settings` as a single JSON blob. On mount the sheet
 * restores + applies. On change it persists + dispatches
 * `sohamhamso:settings-changed` so siblings (e.g., ScriptSwitcher
 * default-script seed) can react.
 *
 * A11y: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, ESC
 * dismiss, scrim dismiss, focus-trap, focus-restore on close.
 * 44px touch targets. Respects prefers-reduced-motion.
 */
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { READING_MODES } from '../lib/reading-modes';

// ─── Option registries ────────────────────────────────────────────────
const SA_FONTS = [
  {
    id: 'noto',
    label: 'Noto Serif Devanagari',
    stack: '"Noto Serif Devanagari", "Shobhika", serif',
  },
  {
    id: 'adishila',
    label: 'Adishila',
    stack: '"Adishila", "Noto Serif Devanagari", serif',
  },
  {
    id: 'shobhika',
    label: 'Shobhika',
    stack: '"Shobhika", "Noto Serif Devanagari", serif',
  },
];

const LATIN_FONTS = [
  {
    id: 'source-serif',
    label: 'Source Serif 4',
    stack: '"Source Serif 4", "Source Serif Pro", "Cardo", Georgia, serif',
  },
  {
    id: 'inter',
    label: 'Inter',
    stack: '"Inter", system-ui, sans-serif',
  },
];

const THEMES = [
  { id: 'light', label: 'Light', swatchBg: '#FAF6EE', swatchInk: '#1C1A17' },
  { id: 'sepia', label: 'Sepia', swatchBg: '#EFE3CC', swatchInk: '#2C2620' },
  { id: 'dark', label: 'Dark', swatchBg: '#14110D', swatchInk: '#ECE5D6' },
  { id: 'oled', label: 'OLED', swatchBg: '#000000', swatchInk: '#ECE5D6' },
  // `auto` resolves to light or dark at runtime via prefers-color-scheme.
  // Stored as `auto` (user intent), but the legacy `sohamhamso:theme`
  // key always gets the *resolved* concrete value so BaseLayout's
  // pre-paint script — which only understands light/sepia/dark/oled —
  // hydrates the right theme on the next page load.
  {
    id: 'auto',
    label: 'Auto',
    swatchBg: 'linear-gradient(135deg, #FAF6EE 0 50%, #14110D 50% 100%)',
    swatchInk: '#1C1A17',
  },
];

// Sourced from the unified READING_MODES catalogue (src/lib/reading-modes.ts)
// so the SettingsSheet language dropdowns stay in lock-step with the
// Masthead picker and the verse-page ScriptSwitcher (12 entries —
// Assamese included). Label format matches the legacy "Native (English)"
// shape, with the English row collapsed to a single "English" label.
const LANGS = READING_MODES.map((m) => ({
  code: m.langCode,
  label: m.englishName === m.nativeLabel ? m.englishName : `${m.nativeLabel} (${m.englishName})`,
}));

const SCRIPTS = [
  { id: 'devanagari', label: 'Devanāgarī' },
  { id: 'iast', label: 'IAST (Latin)' },
  { id: 'bengali', label: 'Bengali / Bāṅlā' },
  { id: 'assamese', label: 'Assamese' },
  { id: 'gujarati', label: 'Gujarati' },
  { id: 'gurmukhi', label: 'Gurmukhi' },
  { id: 'kannada', label: 'Kannada' },
  { id: 'malayalam', label: 'Malayalam' },
  { id: 'oriya', label: 'Odia' },
  { id: 'tamil', label: 'Tamil' },
  { id: 'telugu', label: 'Telugu' },
];

// ─── Default settings ─────────────────────────────────────────────────
interface Settings {
  saFont: string;
  latinFont: string;
  fontSizePx: number;
  lineHeight: number;
  theme: 'light' | 'sepia' | 'dark' | 'oled' | 'auto';
  defaultLang: string;
  defaultScript: string;
  readerLang: string;
}

const DEFAULTS: Settings = {
  saFont: 'noto',
  latinFont: 'source-serif',
  fontSizePx: 18,
  lineHeight: 1.6,
  theme: 'light',
  defaultLang: 'en',
  defaultScript: 'devanagari',
  readerLang: 'en',
};

const STORAGE_KEY = 'sohamhamso:settings';
const LEGACY_THEME_KEY = 'sohamhamso:theme';
const READER_LANG_KEY = 'sohamhamso:reader-lang';

// Resolve a stored theme to the concrete value applied to <html>.
// `auto` follows the system via `prefers-color-scheme`; the four
// concrete themes are identity. Centralized so applySettings and the
// matchMedia change-listener stay in lock-step.
function resolveTheme(theme: Settings['theme']): 'light' | 'sepia' | 'dark' | 'oled' {
  if (theme !== 'auto') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ─── Apply settings to <html> as CSS vars / data-attrs ────────────────
function applySettings(s: Settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const saFont = SA_FONTS.find((f) => f.id === s.saFont) ?? SA_FONTS[0];
  const latinFont = LATIN_FONTS.find((f) => f.id === s.latinFont) ?? LATIN_FONTS[0];
  root.style.setProperty('--font-sa-body', saFont.stack);
  root.style.setProperty('--font-iast', latinFont.stack);
  // Live font-size: set the base, downstream verse text uses --text-md
  // (1.125rem ≈ base * 1.125). We tweak --text-base on root so the
  // whole rhythm scales smoothly. Stored as px, written as px.
  root.style.setProperty('--text-base', `${s.fontSizePx}px`);
  root.style.setProperty('--line-height-iast', String(s.lineHeight));
  // Theme drives swatch tokens via [data-theme] in tokens.css. For
  // `auto` we resolve via prefers-color-scheme so the rendered theme
  // tracks the system; user intent (`auto`) stays in the settings blob.
  const resolved = resolveTheme(s.theme);
  if (resolved === 'light') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', resolved);
  }
  // Keep BaseLayout's pre-paint theme bootstrap in sync. The legacy
  // key only understands concrete themes, so we write the *resolved*
  // value (not `auto`); next pre-paint hydrates the right theme.
  try {
    if (resolved === 'light') localStorage.removeItem(LEGACY_THEME_KEY);
    else localStorage.setItem(LEGACY_THEME_KEY, resolved);
  } catch {
    /* localStorage unavailable */
  }
}

function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const dedicatedReaderLang = localStorage.getItem(READER_LANG_KEY);
    const base = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
    // The dedicated key takes precedence — it's the source of truth for
    // ReaderLangSwap; if a user (or test) wrote it directly, honor it.
    if (dedicatedReaderLang) base.readerLang = dedicatedReaderLang;
    return base;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    // Mirror reader-lang to its own dedicated key so ReaderLangSwap (and
    // any future island) can read it in isolation without parsing the
    // whole settings blob.
    localStorage.setItem(READER_LANG_KEY, s.readerLang);
  } catch {
    /* ignore */
  }
  document.dispatchEvent(new CustomEvent('sohamhamso:settings-changed', { detail: s }));
}

export default function SettingsSheet() {
  const [open, setOpen] = createSignal(false);
  const [settings, setSettings] = createSignal<Settings>({ ...DEFAULTS });

  let sheetEl: HTMLDialogElement | undefined;
  const titleId = 'settings-sheet-title';
  let lastFocused: HTMLElement | null = null;
  // Touch-drag dismiss state (mobile only)
  let touchStartY = 0;
  let touchDelta = 0;
  // `auto` theme listener — re-applies whenever the system flips
  // light↔dark so the rendered theme tracks the OS in real time.
  let mql: MediaQueryList | null = null;
  let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

  const update = (patch: Partial<Settings>) => {
    const prev = settings();
    const next = { ...prev, ...patch };
    setSettings(next);
    applySettings(next);
    saveSettings(next);
    // Reader-language is a special-case: a separate event so any
    // ReaderLangSwap island on a verse page can do a near-instant
    // client-side swap of gloss + translation text.
    if (patch.readerLang !== undefined && patch.readerLang !== prev.readerLang) {
      document.dispatchEvent(
        new CustomEvent('sohamhamso:reader-lang-change', {
          detail: { lang: next.readerLang },
        }),
      );
    }
  };

  const openSheet = () => {
    lastFocused = (document.activeElement as HTMLElement | null) ?? null;
    setOpen(true);
    // After paint, move focus into the sheet.
    queueMicrotask(() => {
      sheetEl
        ?.querySelector<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        )
        ?.focus();
    });
  };

  const closeSheet = () => {
    setOpen(false);
    if (sheetEl) sheetEl.style.transform = '';
    // Restore focus to whatever opened us.
    queueMicrotask(() => lastFocused?.focus?.());
  };

  const reset = () => {
    setSettings({ ...DEFAULTS });
    applySettings(DEFAULTS);
    saveSettings(DEFAULTS);
  };

  // Focus-trap inside the dialog. Tab / Shift-Tab cycle the focusables.
  const handleKey = (e: KeyboardEvent) => {
    if (!open()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== 'Tab' || !sheetEl) return;
    const focusables = sheetEl.querySelectorAll<HTMLElement>(
      'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const handleOpenRequest = () => openSheet();

  // External settings updates (e.g., the Masthead one-tap theme toggle)
  // re-sync the local signal so the theme-swatch "pressed" state and any
  // other displayed value reflect reality. We ignore events we ourselves
  // dispatched by comparing the detail.theme against the current signal.
  const handleExternalChange = (e: Event) => {
    const detail = (e as CustomEvent<Partial<Settings>>).detail;
    if (!detail) return;
    const current = settings();
    // Only react if at least one field differs — avoids feedback loops
    // from our own dispatch above.
    let dirty = false;
    for (const k of Object.keys(detail) as (keyof Settings)[]) {
      if (detail[k] !== undefined && detail[k] !== current[k]) {
        dirty = true;
        break;
      }
    }
    if (!dirty) return;
    const next = loadSettings();
    setSettings(next);
    // No applySettings here — whoever dispatched already applied.
  };

  // Touch-drag dismiss (mobile sheet only).
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
    else if (sheetEl) sheetEl.style.transform = '';
    touchDelta = 0;
  };

  onMount(() => {
    if (typeof document === 'undefined') return;
    const initial = loadSettings();
    setSettings(initial);
    applySettings(initial);
    document.addEventListener('sohamhamso:open-settings', handleOpenRequest);
    document.addEventListener('sohamhamso:settings-changed', handleExternalChange);
    document.addEventListener('keydown', handleKey);
    // Track the system color scheme so `theme: 'auto'` re-renders when
    // the OS flips. Listener is live for the lifetime of the island,
    // not gated on `open()`, so the page stays in sync even when the
    // sheet is closed.
    if (typeof window !== 'undefined' && window.matchMedia) {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mqlHandler = () => {
        if (settings().theme === 'auto') applySettings(settings());
      };
      mql.addEventListener('change', mqlHandler);
    }
  });
  onCleanup(() => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('sohamhamso:open-settings', handleOpenRequest);
    document.removeEventListener('sohamhamso:settings-changed', handleExternalChange);
    document.removeEventListener('keydown', handleKey);
    if (mql && mqlHandler) mql.removeEventListener('change', mqlHandler);
    mql = null;
    mqlHandler = null;
  });

  // Live-preview sample. Uses current saFont and fontSizePx via the
  // applied CSS vars so the user sees the change as the slider moves.
  return (
    <Show when={open()}>
      <div class="settings__scrim" onClick={closeSheet} aria-hidden="true" />
      <dialog
        open
        ref={sheetEl}
        class="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div class="settings__handle" aria-hidden="true" />

        <header class="settings__head">
          <h2 id={titleId}>Reading settings</h2>
          <button
            type="button"
            class="settings__close"
            onClick={closeSheet}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <div class="settings__body">
          {/* Live preview */}
          <div class="settings__preview" aria-hidden="true">
            <div class="settings__preview-sa" lang="sa">
              तत्त्वमसि
            </div>
            <div class="settings__preview-iast">Sample verse text — tat tvam asi.</div>
          </div>

          {/* Font — Devanāgarī */}
          <fieldset class="settings__fs">
            <legend>Font — Devanāgarī</legend>
            <div class="settings__radios">
              <For each={SA_FONTS}>
                {(f) => (
                  <label class="settings__radio">
                    <input
                      type="radio"
                      name="sa-font"
                      value={f.id}
                      checked={settings().saFont === f.id}
                      onChange={() => update({ saFont: f.id })}
                    />
                    <span>{f.label}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>

          {/* Font — Latin */}
          <fieldset class="settings__fs">
            <legend>Font — Latin</legend>
            <div class="settings__radios">
              <For each={LATIN_FONTS}>
                {(f) => (
                  <label class="settings__radio">
                    <input
                      type="radio"
                      name="latin-font"
                      value={f.id}
                      checked={settings().latinFont === f.id}
                      onChange={() => update({ latinFont: f.id })}
                    />
                    <span>{f.label}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>

          {/* Font size */}
          <fieldset class="settings__fs">
            <legend>
              Font size <span class="settings__val">{settings().fontSizePx}px</span>
            </legend>
            <input
              type="range"
              min="14"
              max="24"
              step="1"
              value={settings().fontSizePx}
              onInput={(e) => update({ fontSizePx: Number(e.currentTarget.value) })}
              aria-label="Font size in pixels"
            />
          </fieldset>

          {/* Line-height */}
          <fieldset class="settings__fs">
            <legend>
              Line-height <span class="settings__val">{settings().lineHeight.toFixed(2)}</span>
            </legend>
            <input
              type="range"
              min="1.4"
              max="2.0"
              step="0.05"
              value={settings().lineHeight}
              onInput={(e) => update({ lineHeight: Number(e.currentTarget.value) })}
              aria-label="Line height"
            />
          </fieldset>

          {/* Theme */}
          <fieldset class="settings__fs">
            <legend>Theme</legend>
            <div class="settings__themes">
              <For each={THEMES}>
                {(t) => (
                  <button
                    type="button"
                    class="settings__theme"
                    aria-pressed={settings().theme === t.id}
                    onClick={() => update({ theme: t.id as Settings['theme'] })}
                  >
                    <span
                      class="settings__theme-swatch"
                      style={{
                        background: t.swatchBg,
                        color: t.swatchInk,
                        'border-color': t.swatchInk,
                      }}
                      aria-hidden="true"
                    >
                      Aa
                    </span>
                    <span class="settings__theme-label">{t.label}</span>
                  </button>
                )}
              </For>
            </div>
          </fieldset>

          {/* Default translation language */}
          <fieldset class="settings__fs">
            <legend>
              <label for="settings-lang">Default translation language</label>
            </legend>
            <select
              id="settings-lang"
              value={settings().defaultLang}
              onChange={(e) => update({ defaultLang: e.currentTarget.value })}
            >
              <For each={LANGS}>{(l) => <option value={l.code}>{l.label}</option>}</For>
            </select>
          </fieldset>

          {/* Reader language — swaps the WHOLE verse anatomy (glosses +
              primary translation) into the chosen language on the verse
              page. English fallback when no content. */}
          <fieldset class="settings__fs">
            <legend>
              <label for="settings-reader-lang">Reader language</label>
            </legend>
            <select
              id="settings-reader-lang"
              value={settings().readerLang}
              onChange={(e) => update({ readerLang: e.currentTarget.value })}
            >
              <For each={LANGS}>{(l) => <option value={l.code}>{l.label}</option>}</For>
            </select>
          </fieldset>

          {/* Default script */}
          <fieldset class="settings__fs">
            <legend>
              <label for="settings-script">Default script</label>
            </legend>
            <select
              id="settings-script"
              value={settings().defaultScript}
              onChange={(e) => update({ defaultScript: e.currentTarget.value })}
            >
              <For each={SCRIPTS}>{(s) => <option value={s.id}>{s.label}</option>}</For>
            </select>
          </fieldset>

          <button type="button" class="settings__reset" onClick={reset}>
            Reset to defaults
          </button>
        </div>

        <style>{`
          .settings__scrim {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 70;
          }
          .settings {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            margin: 0;
            padding: 0;
            width: 100%;
            max-width: 100%;
            max-height: 85vh;
            background: var(--color-surface);
            color: var(--color-ink);
            border: 0;
            border-top: 1px solid var(--color-rule);
            border-radius: 16px 16px 0 0;
            z-index: 71;
            overflow-y: auto;
            touch-action: pan-y;
            transition: transform var(--motion-base) var(--easing-out);
          }
          @media (prefers-reduced-motion: reduce) {
            .settings { transition: none; }
          }
          @media (min-width: 768px) {
            .settings {
              left: 50%;
              right: auto;
              bottom: auto;
              top: 64px;
              transform: translateX(-50%);
              width: 480px;
              max-height: 80vh;
              border-radius: 12px;
              border: 1px solid var(--color-rule);
            }
          }
          .settings__handle {
            width: 32px;
            height: 4px;
            margin: 8px auto 0;
            background: var(--color-rule);
            border-radius: 999px;
          }
          @media (min-width: 768px) {
            .settings__handle { display: none; }
          }
          .settings__head {
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
          .settings__head h2 {
            margin: 0;
            font-family: var(--font-chrome);
            font-size: var(--text-base);
            font-weight: 600;
          }
          .settings__close {
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
          .settings__body {
            padding: var(--spacing-4);
            display: grid;
            gap: var(--spacing-5);
          }
          .settings__preview {
            padding: var(--spacing-4);
            background: var(--color-bg);
            border: 1px solid var(--color-rule);
            border-radius: 6px;
            display: grid;
            gap: var(--spacing-2);
          }
          .settings__preview-sa {
            font-family: var(--font-sa-body);
            font-size: calc(var(--text-base) * 1.4);
            line-height: 1.75;
          }
          .settings__preview-iast {
            font-family: var(--font-iast);
            font-style: italic;
            font-size: var(--text-base);
            line-height: var(--line-height-iast);
            color: var(--color-ink-muted);
          }
          .settings__fs {
            border: 0;
            margin: 0;
            padding: 0;
            display: grid;
            gap: var(--spacing-2);
          }
          .settings__fs legend {
            font-family: var(--font-chrome);
            font-size: var(--text-xs);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--color-ink-muted);
            padding: 0;
          }
          .settings__val {
            font-variant-numeric: tabular-nums;
            margin-inline-start: var(--spacing-2);
            color: var(--color-ink);
            text-transform: none;
            letter-spacing: 0;
          }
          .settings__radios {
            display: grid;
            gap: var(--spacing-2);
          }
          .settings__radio {
            display: flex;
            align-items: center;
            gap: var(--spacing-3);
            min-height: 44px;
            padding: 0 var(--spacing-2);
            font-family: var(--font-chrome);
            font-size: var(--text-sm);
            cursor: pointer;
          }
          .settings__radio input {
            width: 18px;
            height: 18px;
            accent-color: var(--color-accent);
          }
          .settings__fs input[type="range"] {
            width: 100%;
            accent-color: var(--color-accent);
            min-height: 44px;
          }
          .settings__themes {
            display: grid;
            /* 5 themes (Light/Sepia/Dark/OLED/Auto) wrap to two rows on
               narrow phones, single row on wider sheets. */
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: var(--spacing-2);
          }
          @media (max-width: 380px) {
            .settings__themes {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }
          .settings__theme {
            display: grid;
            justify-items: center;
            gap: 6px;
            padding: var(--spacing-2);
            background: transparent;
            border: 1px solid var(--color-rule);
            border-radius: 6px;
            cursor: pointer;
            min-height: 44px;
            font-family: var(--font-chrome);
            font-size: var(--text-xs);
            color: var(--color-ink);
          }
          .settings__theme[aria-pressed="true"] {
            border-color: var(--color-accent);
            box-shadow: 0 0 0 1px var(--color-accent);
          }
          .settings__theme-swatch {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            border-radius: 4px;
            border: 1px solid transparent;
            font-family: var(--font-iast);
            font-style: italic;
            font-weight: 500;
          }
          .settings__theme-label {
            font-size: var(--text-xs);
          }
          .settings__fs select {
            appearance: none;
            width: 100%;
            min-height: 44px;
            padding: 0 var(--spacing-3);
            font-family: var(--font-chrome);
            font-size: var(--text-sm);
            background: var(--color-bg);
            color: var(--color-ink);
            border: 1px solid var(--color-rule);
            border-radius: 4px;
          }
          .settings__reset {
            justify-self: start;
            min-height: 44px;
            padding: 0 var(--spacing-4);
            background: transparent;
            border: 1px solid var(--color-rule);
            border-radius: 4px;
            color: var(--color-ink-muted);
            font-family: var(--font-chrome);
            font-size: var(--text-sm);
            cursor: pointer;
          }
          .settings__reset:hover {
            color: var(--color-ink);
            border-color: var(--color-ink-muted);
          }
        `}</style>
      </dialog>
    </Show>
  );
}
