export interface VerseHit {
  verse_id: number;
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
  score: number;
  source: 'lexical' | 'semantic' | 'blended';
}
