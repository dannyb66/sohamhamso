/**
 * ReaderLangSwap — verse-page Solid island. Reads the user's chosen
 * reader language from `localStorage["sohamhamso:reader-lang"]` and swaps
 * the static English gloss + primary translation into that language using
 * the pre-bundled `window.__readerData` payload.
 *
 * Pre-bundled payload shape (injected by verse.astro):
 *   window.__readerData = {
 *     glosses_by_lang: { en: [...], hi: [...], ... },
 *     translations_by_lang: { en: {...}, hi: {...}, ... }
 *   }
 *
 * Behavior:
 *   - On mount: reads the chosen lang. Defaults to "en".
 *     If lang ≠ "en", performs the swap.
 *   - Listens for `sohamhamso:reader-lang-change` and re-applies on the fly.
 *   - English fallback: if a target-lang gloss/translation is missing the
 *     English content is left untouched (never blanks out).
 *
 * The swap uses targeted `textContent` writes (not innerHTML), preserving
 * the lemma <button data-word-idx data-verse-id> elements so the WordSheet
 * click delegation continues to work after the swap. Only the
 * `.sa-gloss` text node next to each lemma is rewritten, and the
 * `.translation` paragraph's textContent is replaced.
 *
 * Mounted via `<ReaderLangSwap client:idle />` in the verse-page Astro
 * route. No SSR output — returns null.
 */
import { onMount, onCleanup } from "solid-js";

interface GlossEntry {
  word_idx: number;
  word_sa: string;
  lemma_iast: string | null;
  gloss_text: string;
  morph: string | null;
}

interface TranslationEntry {
  lang: string;
  translation_text: string;
  translator: string | null;
  ai_assisted: boolean;
}

interface ReaderData {
  glosses_by_lang?: Record<string, GlossEntry[]>;
  translations_by_lang?: Record<string, TranslationEntry>;
}

declare global {
  interface Window {
    __readerData?: ReaderData;
  }
}

const STORAGE_KEY = "sohamhamso:reader-lang";

function currentLang(): string {
  if (typeof localStorage === "undefined") return "en";
  try {
    return localStorage.getItem(STORAGE_KEY) || "en";
  } catch {
    return "en";
  }
}

/**
 * Apply the chosen language to the live DOM. Idempotent and re-runnable
 * (so the language change event can fire multiple times in one session).
 *
 * Strategy:
 *   1. For each `.synonyms` block, look up the gloss array for `lang`.
 *      If present, iterate `.sa-gloss` siblings and rewrite their
 *      textContent to ` — {gloss_text}` matching the SSR shape. The
 *      `.sa-word` lemma button is untouched (Sanskrit doesn't translate).
 *   2. For the `.translation` paragraph, look up the translation for `lang`.
 *      If present, replace textContent and set the `lang` attribute so
 *      per-script CSS line-heights kick in.
 *   3. Any miss → leave the English content alone.
 */
function applyLang(lang: string) {
  if (typeof document === "undefined") return;
  const data = window.__readerData;
  if (!data) return;

  const synonymsBlocks = document.querySelectorAll<HTMLElement>(".synonyms");
  for (const block of Array.from(synonymsBlocks)) {
    const enGlosses = data.glosses_by_lang?.en ?? [];
    const targetGlosses =
      lang === "en"
        ? enGlosses
        : data.glosses_by_lang?.[lang] ?? null;

    // Fallback: if no glosses for this lang, restore the English ones.
    const source = targetGlosses ?? enGlosses;
    if (source.length === 0) continue;

    const glossSpans = block.querySelectorAll<HTMLElement>(".sa-gloss");
    const byIdx = new Map<number, string>();
    for (const g of source) byIdx.set(g.word_idx, g.gloss_text);

    // The synonyms section emits `.sa-word`/`.sa-gloss` pairs in word_idx
    // order — index N of `.sa-gloss` corresponds to the Nth gloss row.
    // We also walk the SA-word buttons to recover word_idx defensively.
    const wordButtons = block.querySelectorAll<HTMLElement>(".sa-word[data-word-idx]");
    glossSpans.forEach((span, i) => {
      const btn = wordButtons[i];
      const idx = btn?.dataset.wordIdx ? Number(btn.dataset.wordIdx) : i;
      const text = byIdx.get(idx);
      if (typeof text === "string") {
        span.textContent = ` — ${text}`;
      }
    });

    // Mark the block lang so any future per-lang CSS hooks attach.
    block.setAttribute("lang", lang);
  }

  const translationP = document.querySelector<HTMLElement>(".translation");
  if (translationP) {
    const enTr = data.translations_by_lang?.en;
    const targetTr =
      lang === "en"
        ? enTr
        : data.translations_by_lang?.[lang] ?? null;

    const tr = targetTr ?? enTr;
    if (tr) {
      translationP.textContent = tr.translation_text;
      translationP.setAttribute("lang", tr.lang);
    }
  }
}

export default function ReaderLangSwap() {
  const handleChange = (e: Event) => {
    const detail = (e as CustomEvent<{ lang?: string }>).detail;
    const lang = detail?.lang || currentLang();
    applyLang(lang);
  };

  onMount(() => {
    if (typeof document === "undefined") return;
    const initial = currentLang();
    // Only touch the DOM if we're swapping away from English — the static
    // page already renders English, so this avoids unnecessary writes.
    if (initial !== "en") applyLang(initial);
    document.addEventListener("sohamhamso:reader-lang-change", handleChange);
  });
  onCleanup(() => {
    if (typeof document === "undefined") return;
    document.removeEventListener(
      "sohamhamso:reader-lang-change",
      handleChange,
    );
  });

  return null;
}
