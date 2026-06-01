/**
 * SearchBox — Solid island. Search overlay with combobox semantics.
 *
 * Triggers:
 *   • `[data-search-trigger]` clicks (the Masthead magnifier)
 *   • `⌘K` / `Ctrl-K` global keyboard shortcut
 *   • the `sohamhamso:open-search` CustomEvent
 *
 * Mount once in BaseLayout (after `<slot />`, alongside SettingsSheet):
 *
 *     ---
 *     import SearchBox from "../components/SearchBox.solid.tsx";
 *     ---
 *     <slot />
 *     <SearchBox client:idle />
 *
 * Behavior:
 *   • 120ms debounce on input → /api/search?type=lexical (fast, as-you-type)
 *   • Empty input shows recent searches + example queries
 *   • Enter → navigate to /search?q=... for the full blended search
 *   • ESC closes, scrim closes
 *   • ↑/↓ navigate results, Enter on a result navigates to its verse
 *   • Recent searches: max 10 in localStorage `sohamhamso:recent-searches`
 *
 * A11y: combobox pattern — `role="combobox"`, `aria-expanded`,
 * `aria-controls`, `aria-activedescendant` on input; result list is
 * `role="listbox"`, each row is `role="option"` with a stable id.
 *
 * Anti-pattern locked: this overlay co-exists with the Masthead's V1
 * placeholder <dialog>. When SearchBox mounts, it suppresses the
 * placeholder by calling `dialog.close()` if it's open, and intercepts
 * the trigger click before the placeholder's listener fires (capture-
 * phase listener + `stopImmediatePropagation`).
 */
import { createSignal, onMount, onCleanup, For, Show } from "solid-js";

// ─── Types ────────────────────────────────────────────────────────────
export interface VerseHit {
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
  score?: number;
}

interface ApiResponse {
  data: VerseHit[];
  meta: { count: number; type: string; took_ms: number };
}

const EXAMPLE_QUERIES = [
  "pratyabhijñā",
  "wherever the mind goes",
  "कृष्ण",
  "recognition",
];

const RECENT_KEY = "sohamhamso:recent-searches";
const MAX_RECENT = 10;

// ─── Helpers ──────────────────────────────────────────────────────────
function loadRecent(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string): string[] {
  const cur = loadRecent();
  const next = [q, ...cur.filter((x) => x !== q)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function verseHref(h: VerseHit): string {
  return `/${h.tradition}/${h.text_slug}/${h.chapter}/${h.verse_num}`;
}

function verseLabel(h: VerseHit): string {
  return `${h.text_title} ${h.chapter}.${h.verse_num}`;
}

// ─── Component ────────────────────────────────────────────────────────
export default function SearchBox() {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<VerseHit[]>([]);
  const [recent, setRecent] = createSignal<string[]>([]);
  const [activeIdx, setActiveIdx] = createSignal(-1);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let inputEl: HTMLInputElement | undefined;
  let listboxId = "sohamhamso-search-listbox";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFocused: HTMLElement | null = null;
  let abortCtl: AbortController | null = null;

  const close = () => {
    setOpen(false);
    setActiveIdx(-1);
    queueMicrotask(() => lastFocused?.focus?.());
  };

  const openBox = () => {
    lastFocused = (document.activeElement as HTMLElement | null) ?? null;
    setOpen(true);
    setRecent(loadRecent());
    queueMicrotask(() => inputEl?.focus());
  };

  const runLexical = async (q: string) => {
    if (abortCtl) abortCtl.abort();
    abortCtl = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&type=lexical&limit=8`,
        { signal: abortCtl.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      setResults(json.data ?? []);
      setActiveIdx(json.data?.length ? 0 : -1);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setError("Couldn't search just now.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const onInput = (e: InputEvent) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    setQuery(v);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!v.trim()) {
      setResults([]);
      setActiveIdx(-1);
      setLoading(false);
      if (abortCtl) abortCtl.abort();
      return;
    }
    debounceTimer = setTimeout(() => {
      runLexical(v.trim());
    }, 120);
  };

  const submitFull = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecent(pushRecent(trimmed));
    close();
    // Full blended search happens on the results page.
    window.location.href = `/search?q=${encodeURIComponent(trimmed)}`;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open()) return;
    const rs = results();
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (rs.length === 0) return;
        setActiveIdx((i) => (i + 1) % rs.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (rs.length === 0) return;
        setActiveIdx((i) => (i <= 0 ? rs.length - 1 : i - 1));
        break;
      case "Enter": {
        e.preventDefault();
        const idx = activeIdx();
        if (idx >= 0 && rs[idx]) {
          setRecent(pushRecent(query().trim()));
          window.location.href = verseHref(rs[idx]);
        } else {
          submitFull(query());
        }
        break;
      }
    }
  };

  const onScrimClick = () => close();

  const onTriggerClick = (e: MouseEvent) => {
    // Capture-phase: intercept BEFORE the Masthead's placeholder listener
    // fires. Suppress the placeholder dialog if it's open.
    const target = e.target as HTMLElement | null;
    if (!target?.closest("[data-search-trigger]")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const placeholder = document.querySelector<HTMLDialogElement>(
      "[data-search-modal]",
    );
    if (placeholder?.open) placeholder.close();
    openBox();
  };

  const onGlobalKey = (e: KeyboardEvent) => {
    // ⌘K / Ctrl-K → open the SearchBox. We add the listener in capture
    // so we beat the Masthead's placeholder shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const placeholder = document.querySelector<HTMLDialogElement>(
        "[data-search-modal]",
      );
      if (placeholder?.open) placeholder.close();
      openBox();
    }
  };

  const onOpenEvent = () => openBox();

  onMount(() => {
    if (typeof document === "undefined") return;
    setRecent(loadRecent());
    document.addEventListener("click", onTriggerClick, true);
    document.addEventListener("keydown", onGlobalKey, true);
    document.addEventListener("sohamhamso:open-search", onOpenEvent);
  });
  onCleanup(() => {
    if (typeof document === "undefined") return;
    document.removeEventListener("click", onTriggerClick, true);
    document.removeEventListener("keydown", onGlobalKey, true);
    document.removeEventListener("sohamhamso:open-search", onOpenEvent);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (abortCtl) abortCtl.abort();
  });

  const activeId = () =>
    activeIdx() >= 0 ? `${listboxId}-opt-${activeIdx()}` : undefined;

  return (
    <Show when={open()}>
      <div class="searchbox__scrim" onClick={onScrimClick} aria-hidden="true" />
      <div
        class="searchbox"
        role="dialog"
        aria-modal="true"
        aria-label="Search verses, words, or concepts"
        onKeyDown={onKeyDown}
      >
        <div class="searchbox__inner">
          <div class="searchbox__field">
            <svg
              class="searchbox__icon"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.5" />
              <line
                x1="13.5"
                y1="13.5"
                x2="17"
                y2="17"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <input
              ref={inputEl}
              type="search"
              class="searchbox__input"
              value={query()}
              onInput={onInput}
              placeholder="pratyabhijñā · wherever the mind goes · कृष्ण"
              autocomplete="off"
              spellcheck={false}
              role="combobox"
              aria-expanded={results().length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeId()}
              aria-label="Search query"
            />
            <button
              type="button"
              class="searchbox__close"
              onClick={close}
              aria-label="Close search"
            >
              esc
            </button>
          </div>

          {/* Empty state — recent + examples */}
          <Show when={!query().trim()}>
            <div class="searchbox__empty">
              <Show when={recent().length > 0}>
                <div class="searchbox__group">
                  <div class="searchbox__group-label">Recent</div>
                  <ul class="searchbox__chips">
                    <For each={recent()}>
                      {(q) => (
                        <li>
                          <button
                            type="button"
                            class="searchbox__chip"
                            onClick={() => {
                              setQuery(q);
                              if (inputEl) inputEl.value = q;
                              runLexical(q);
                            }}
                          >
                            {q}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              <div class="searchbox__group">
                <div class="searchbox__group-label">Try</div>
                <ul class="searchbox__chips">
                  <For each={EXAMPLE_QUERIES}>
                    {(q) => (
                      <li>
                        <button
                          type="button"
                          class="searchbox__chip"
                          onClick={() => {
                            setQuery(q);
                            if (inputEl) inputEl.value = q;
                            runLexical(q);
                          }}
                        >
                          {q}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </div>
          </Show>

          {/* Results listbox */}
          <Show when={query().trim()}>
            <Show when={loading() && results().length === 0}>
              <div class="searchbox__status" aria-live="polite">
                Searching…
              </div>
            </Show>
            <Show when={error()}>
              <div class="searchbox__status searchbox__status--err" role="alert">
                {error()}
              </div>
            </Show>
            <Show when={!loading() && !error() && results().length === 0}>
              <div class="searchbox__status" aria-live="polite">
                No quick matches. Press Enter for a full semantic search.
              </div>
            </Show>
            <Show when={results().length > 0}>
              <ul
                id={listboxId}
                class="searchbox__results"
                role="listbox"
                aria-label="Search results"
              >
                <For each={results()}>
                  {(h, i) => (
                    <li
                      id={`${listboxId}-opt-${i()}`}
                      role="option"
                      aria-selected={activeIdx() === i()}
                      class="searchbox__row"
                      classList={{
                        "searchbox__row--active": activeIdx() === i(),
                      }}
                      onMouseEnter={() => setActiveIdx(i())}
                      onClick={() => {
                        setRecent(pushRecent(query().trim()));
                        window.location.href = verseHref(h);
                      }}
                    >
                      <div class="searchbox__row-crumb">{verseLabel(h)}</div>
                      <div class="searchbox__row-sa" lang="sa" data-sa>
                        {h.devanagari}
                      </div>
                      <Show when={h.iast}>
                        <div class="searchbox__row-iast">{h.iast}</div>
                      </Show>
                      <Show when={h.translation_excerpt}>
                        <div class="searchbox__row-en">
                          {h.translation_excerpt}
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <div class="searchbox__footer">
                <button
                  type="button"
                  class="searchbox__more"
                  onClick={() => submitFull(query())}
                >
                  More results → /search?q={query().trim()}
                </button>
              </div>
            </Show>
          </Show>
        </div>

        <style>{`
          .searchbox__scrim {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 80;
          }
          .searchbox {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding: 56px var(--spacing-4) var(--spacing-4);
            z-index: 81;
            pointer-events: none;
          }
          @media (min-width: 768px) {
            .searchbox { padding-top: 88px; }
          }
          .searchbox__inner {
            pointer-events: auto;
            width: 100%;
            max-width: 640px;
            background: var(--color-surface);
            color: var(--color-ink);
            border: 1px solid var(--color-rule);
            border-radius: 8px;
            box-shadow: 0 10px 32px rgba(0,0,0,0.12);
            display: grid;
            grid-template-rows: auto 1fr;
            max-height: calc(100vh - 96px);
            overflow: hidden;
          }
          .searchbox__field {
            display: flex;
            align-items: center;
            gap: var(--spacing-2);
            padding: var(--spacing-3) var(--spacing-4);
            border-block-end: 1px solid var(--color-rule);
          }
          .searchbox__icon {
            color: var(--color-ink-muted);
            flex: 0 0 auto;
          }
          .searchbox__input {
            flex: 1;
            min-width: 0;
            min-height: 44px;
            appearance: none;
            background: transparent;
            border: 0;
            outline: none;
            color: var(--color-ink);
            font-family: var(--font-iast);
            font-size: var(--text-md);
          }
          .searchbox__input::placeholder {
            color: var(--color-ink-muted);
          }
          .searchbox__close {
            appearance: none;
            min-height: 44px;
            padding: 0 10px;
            background: transparent;
            border: 1px solid var(--color-rule);
            border-radius: 4px;
            color: var(--color-ink-muted);
            font-family: var(--font-chrome);
            font-size: var(--text-xs);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            cursor: pointer;
          }
          .searchbox__empty {
            padding: var(--spacing-4);
            display: grid;
            gap: var(--spacing-4);
            overflow-y: auto;
          }
          .searchbox__group-label {
            font-family: var(--font-chrome);
            font-size: var(--text-xs);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--color-ink-muted);
            margin-block-end: var(--spacing-2);
          }
          .searchbox__chips {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-wrap: wrap;
            gap: var(--spacing-2);
          }
          .searchbox__chip {
            min-height: 44px;
            padding: 0 var(--spacing-3);
            background: var(--color-bg);
            border: 1px solid var(--color-rule);
            border-radius: 999px;
            color: var(--color-ink);
            font-family: var(--font-chrome);
            font-size: var(--text-sm);
            cursor: pointer;
          }
          .searchbox__chip:hover {
            border-color: var(--color-ink-muted);
          }
          .searchbox__status {
            padding: var(--spacing-4);
            color: var(--color-ink-muted);
            font-family: var(--font-chrome);
            font-size: var(--text-sm);
          }
          .searchbox__status--err { color: var(--color-error); }
          .searchbox__results {
            list-style: none;
            margin: 0;
            padding: 0;
            overflow-y: auto;
          }
          .searchbox__row {
            display: grid;
            gap: 4px;
            padding: var(--spacing-3) var(--spacing-4);
            border-block-end: 1px solid var(--color-rule);
            cursor: pointer;
          }
          .searchbox__row--active {
            background: var(--color-bg);
          }
          .searchbox__row-crumb {
            font-family: var(--font-chrome);
            font-size: var(--text-xs);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--color-ink-muted);
          }
          .searchbox__row-sa {
            font-family: var(--font-sa-body);
            font-size: var(--text-md);
            line-height: 1.5;
          }
          .searchbox__row-iast {
            font-family: var(--font-iast);
            font-style: italic;
            font-size: var(--text-sm);
            color: var(--color-ink-muted);
          }
          .searchbox__row-en {
            font-family: var(--font-iast);
            font-size: var(--text-sm);
            color: var(--color-ink);
            line-height: 1.5;
          }
          .searchbox__footer {
            padding: var(--spacing-2) var(--spacing-4) var(--spacing-3);
            border-block-start: 1px solid var(--color-rule);
            background: var(--color-bg);
          }
          .searchbox__more {
            appearance: none;
            background: transparent;
            border: 0;
            padding: 8px 0;
            color: var(--color-accent);
            font-family: var(--font-chrome);
            font-size: var(--text-sm);
            cursor: pointer;
          }
          @media (prefers-reduced-motion: reduce) {
            .searchbox, .searchbox__scrim { transition: none; }
          }
        `}</style>
      </div>
    </Show>
  );
}
