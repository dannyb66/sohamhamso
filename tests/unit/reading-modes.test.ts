/**
 * Pins the unified "reading mode" catalogue (src/lib/reading-modes.ts)
 * shared by Masthead, ScriptSwitcher, and SettingsSheet.
 *
 * Why a regression test:
 *   Pre-2026-06-01 the three pickers each carried their own list with
 *   drifting labels, drifting counts (11 vs 12), and drifting wiring
 *   (the Masthead dropdown was cosmetic — no click handler). Aligning
 *   them required a single source of truth + a helper that owns the
 *   persist + dispatch contract. This test pins both: the catalogue
 *   shape AND the storage-key/event contract applyReadingMode owes
 *   every island downstream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READING_MODES,
  type ReadingMode,
  applyReadingMode,
  getReadingModeByLang,
  getReadingModeByScript,
} from '../../src/lib/reading-modes';

describe('READING_MODES catalogue', () => {
  it('contains exactly 12 reading modes in the canonical UI order', () => {
    // The 12-row shape is locked. Hindi and Marathi BOTH appear despite
    // sharing scriptId='devanagari' — they're distinct reader languages
    // and we never want to collapse them in the picker UI.
    const expectedOrder = ['en', 'hi', 'mr', 'bn', 'as', 'gu', 'pa', 'kn', 'ml', 'or', 'ta', 'te'];
    expect(READING_MODES.map((m) => m.langCode)).toEqual(expectedOrder);
    expect(READING_MODES).toHaveLength(12);
  });

  it('every row carries both a langCode and a scriptId plus display labels', () => {
    for (const mode of READING_MODES) {
      expect(mode.langCode).toBeTruthy();
      expect(mode.scriptId).toBeTruthy();
      expect(mode.nativeLabel.length).toBeGreaterThan(0);
      expect(mode.englishName.length).toBeGreaterThan(0);
      expect(typeof mode.availableInDb).toBe('boolean');
    }
  });

  it('Hindi and Marathi share scriptId="devanagari" but remain distinct rows', () => {
    const hi = getReadingModeByLang('hi');
    const mr = getReadingModeByLang('mr');
    expect(hi?.scriptId).toBe('devanagari');
    expect(mr?.scriptId).toBe('devanagari');
    expect(hi).not.toBe(mr);
    expect(hi?.nativeLabel).toBe('हिन्दी');
    expect(mr?.nativeLabel).toBe('मराठी');
  });

  it('English row uses scriptId="iast" so picking it falls back to Latin', () => {
    const en = getReadingModeByLang('en');
    expect(en?.scriptId).toBe('iast');
  });

  it('getReadingModeByScript("devanagari") returns Hindi (first match)', () => {
    // The disambiguation rule documented in reading-modes.ts.
    const mode = getReadingModeByScript('devanagari');
    expect(mode?.langCode).toBe('hi');
  });
});

describe('applyReadingMode', () => {
  // Minimal localStorage shim — vitest's default Node env has no
  // localStorage. We only need .setItem / .getItem semantics here.
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };

  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal('localStorage', localStorageMock);
    // Tiny document stub: we only call dispatchEvent + need CustomEvent
    // to be constructable. Node 22's global CustomEvent is sufficient.
    const events: Event[] = [];
    vi.stubGlobal('document', {
      dispatchEvent: (e: Event) => {
        events.push(e);
        return true;
      },
      __events: events,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applyReadingMode('bn') writes both localStorage keys + dispatches the event", () => {
    const mode = applyReadingMode('bn') as ReadingMode | undefined;
    expect(mode?.langCode).toBe('bn');
    expect(mode?.scriptId).toBe('bengali');
    expect(localStorage.getItem('sohamhamso:script')).toBe('bengali');
    expect(localStorage.getItem('sohamhamso:reader-lang')).toBe('bn');
    const events = (globalThis as unknown as { document: { __events: Event[] } }).document.__events;
    expect(events).toHaveLength(1);
    const evt = events[0] as CustomEvent<{ lang: string }>;
    expect(evt.type).toBe('sohamhamso:reader-lang-change');
    expect(evt.detail).toEqual({ lang: 'bn' });
  });

  it("applyReadingMode('hi') sets script=devanagari + reader-lang=hi", () => {
    applyReadingMode('hi');
    expect(localStorage.getItem('sohamhamso:script')).toBe('devanagari');
    expect(localStorage.getItem('sohamhamso:reader-lang')).toBe('hi');
  });

  it("applyReadingMode('mr') also sets script=devanagari but reader-lang=mr", () => {
    // Pins the Hindi-vs-Marathi disambiguation: same script, different lang.
    applyReadingMode('mr');
    expect(localStorage.getItem('sohamhamso:script')).toBe('devanagari');
    expect(localStorage.getItem('sohamhamso:reader-lang')).toBe('mr');
  });

  it('an unknown lang code is a no-op (returns undefined, writes nothing)', () => {
    const result = applyReadingMode('xx');
    expect(result).toBeUndefined();
    expect(localStorage.getItem('sohamhamso:script')).toBeNull();
    expect(localStorage.getItem('sohamhamso:reader-lang')).toBeNull();
  });
});
