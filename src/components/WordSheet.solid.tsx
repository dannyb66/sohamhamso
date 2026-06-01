/**
 * WordSheet — Solid island that opens a bottom sheet when any
 * `[data-word-idx]` element on the page is tapped.
 *
 * Pattern: Quran.com word-sheet. Listens via document-level event
 * delegation so it works regardless of which Astro component rendered
 * the tappable word.
 *
 * V1 simplification: glosses come from `window.__wordGlosses`, a
 * verse-id-keyed map injected by the page's Astro frontmatter. Full
 * client-side fetch (with caching) lands in V1.1.
 *
 * Dismiss: ESC, scrim click, swipe-down (touch handlers), close button.
 */
import { Show, createSignal, onCleanup, onMount } from 'solid-js';

interface GlossEntry {
  word_idx: number;
  word_sa: string;
  lemma_sa?: string | null;
  lemma_iast?: string | null;
  gloss_text: string;
  morph?: string | null;
  /** Number of other verses in the same text containing this lemma. */
  occurrence_count?: number;
  /** Slug of the text the gloss belongs to — used to scope the search link. */
  text_slug?: string;
}

declare global {
  interface Window {
    __wordGlosses?: Record<string, GlossEntry[]>;
  }
}

export default function WordSheet() {
  const [open, setOpen] = createSignal(false);
  const [gloss, setGloss] = createSignal<GlossEntry | null>(null);

  // Touch-drag dismiss state
  let touchStartY = 0;
  let touchDelta = 0;
  let sheetEl: HTMLDialogElement | undefined;

  const close = () => {
    setOpen(false);
    setGloss(null);
    if (sheetEl) {
      sheetEl.style.transform = '';
    }
  };

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const trigger = target.closest<HTMLElement>('[data-word-idx]');
    if (!trigger) return;
    e.preventDefault();

    const verseId = trigger.dataset.verseId ?? '';
    const wordIdx = Number(trigger.dataset.wordIdx ?? '-1');
    const pool = window.__wordGlosses?.[verseId] ?? [];
    const found = pool.find((g) => g.word_idx === wordIdx);

    if (found) {
      setGloss(found);
    } else {
      // No gloss available — still open the sheet with the lemma so
      // the user gets a "no gloss yet, contribute" affordance.
      setGloss({
        word_idx: wordIdx,
        word_sa: trigger.textContent ?? '',
        gloss_text: '',
      });
    }
    setOpen(true);
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open()) close();
  };

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
    if (touchDelta > 80) {
      close();
    } else if (sheetEl) {
      sheetEl.style.transform = '';
    }
    touchDelta = 0;
  };

  onMount(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
  });
  onCleanup(() => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('click', handleClick);
    document.removeEventListener('keydown', handleKey);
  });

  return (
    <Show when={open()}>
      <div class="word-sheet__scrim" onClick={close} aria-hidden="true" />
      <dialog
        open
        ref={sheetEl}
        class="word-sheet"
        aria-label="Word details"
        aria-modal="true"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div class="word-sheet__handle" aria-hidden="true" />

        <header class="word-sheet__head">
          <div>
            <div class="word-sheet__lemma" lang="sa" data-sa>
              {gloss()?.lemma_sa ?? gloss()?.word_sa}
            </div>
            <Show when={gloss()?.lemma_iast}>
              <div class="word-sheet__iast">{gloss()?.lemma_iast}</div>
            </Show>
          </div>
          <button type="button" class="word-sheet__close" onClick={close} aria-label="Close">
            ×
          </button>
        </header>

        <div class="word-sheet__body">
          <Show
            when={gloss()?.gloss_text}
            fallback={
              <p class="word-sheet__empty">
                No gloss yet for this word — <a href="/contribute">help us add one</a>.
              </p>
            }
          >
            <p class="word-sheet__gloss">{gloss()?.gloss_text}</p>
          </Show>

          <Show when={gloss()?.morph}>
            <div class="word-sheet__morph" aria-label="morphology">
              {gloss()
                ?.morph?.split(/[,\s]+/)
                .filter(Boolean)
                .map((chip) => (
                  <span class="word-sheet__chip">{chip}</span>
                ))}
            </div>
          </Show>

          <Show when={(gloss()?.occurrence_count ?? 0) > 0 && gloss()?.lemma_iast}>
            <p class="word-sheet__occurrences">
              <a
                class="word-sheet__occurrences-link"
                href={`/search?q=${encodeURIComponent(gloss()?.lemma_iast ?? '')}`}
              >
                {gloss()?.occurrence_count} more occurrence
                {gloss()?.occurrence_count === 1 ? '' : 's'} in this text →
              </a>
            </p>
          </Show>

          <p class="word-sheet__cologne">
            <a
              href={`https://www.sanskrit-lexicon.uni-koeln.de/scans/MWScan/2020/web/webtc/indexcaller.php?key=${encodeURIComponent(
                gloss()?.lemma_iast ?? gloss()?.word_sa ?? '',
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Monier-Williams · Cologne ↗
            </a>
          </p>
        </div>
      </dialog>

      <style>{`
        .word-sheet__scrim {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.4);
          z-index: 60;
        }
        .word-sheet {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          margin: 0;
          padding: 0;
          width: 100%;
          max-width: 100%;
          max-height: 60vh;
          background: var(--color-surface);
          color: var(--color-ink);
          border: 0;
          border-top: 1px solid var(--color-rule);
          border-radius: 16px 16px 0 0;
          z-index: 61;
          overflow-y: auto;
          touch-action: pan-y;
          transition: transform var(--motion-base) var(--easing-out);
        }
        @media (prefers-reduced-motion: reduce) {
          .word-sheet { transition: none; }
        }
        @media (min-width: 768px) {
          .word-sheet {
            left: 50%;
            right: auto;
            bottom: auto;
            top: 80px;
            transform: translateX(-50%);
            width: 420px;
            max-height: 70vh;
            border-radius: 12px;
            border: 1px solid var(--color-rule);
          }
        }
        .word-sheet__handle {
          width: 32px;
          height: 4px;
          margin: 8px auto 0;
          background: var(--color-rule);
          border-radius: 999px;
        }
        @media (min-width: 768px) {
          .word-sheet__handle { display: none; }
        }
        .word-sheet__head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: var(--spacing-4);
          border-block-end: 1px solid var(--color-rule);
        }
        .word-sheet__lemma {
          font-family: var(--font-sa-body);
          font-size: var(--text-lg);
          line-height: 1.4;
          color: var(--color-ink);
        }
        .word-sheet__iast {
          font-family: var(--font-iast);
          font-style: italic;
          font-size: var(--text-sm);
          color: var(--color-ink-muted);
          margin-top: 2px;
        }
        .word-sheet__close {
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
        .word-sheet__body {
          padding: var(--spacing-4);
          display: grid;
          gap: var(--spacing-4);
        }
        .word-sheet__gloss {
          margin: 0;
          font-family: var(--font-iast);
          font-size: var(--text-md);
          line-height: 1.5;
          color: var(--color-ink);
        }
        .word-sheet__empty {
          margin: 0;
          font-family: var(--font-iast);
          font-size: var(--text-sm);
          color: var(--color-ink-muted);
        }
        .word-sheet__morph {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .word-sheet__chip {
          display: inline-block;
          padding: 4px 8px;
          font-family: var(--font-chrome);
          font-size: var(--text-xs);
          background: var(--color-bg);
          border: 1px solid var(--color-rule);
          border-radius: 4px;
          color: var(--color-ink-muted);
        }
        .word-sheet__cologne {
          margin: 0;
          font-family: var(--font-chrome);
          font-size: var(--text-sm);
        }
        .word-sheet__occurrences {
          margin: 0;
          font-family: var(--font-chrome);
          font-size: var(--text-sm);
        }
        .word-sheet__occurrences-link {
          color: var(--color-ink);
          text-decoration: none;
        }
        .word-sheet__occurrences-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </Show>
  );
}
