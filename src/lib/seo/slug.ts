export function asciiStrip(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function slugifyLemmaBase(lemmaIast: string): string {
  const stripped = asciiStrip(lemmaIast).toLowerCase();
  const cleaned = stripped
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return cleaned.length > 0 ? cleaned : 'lemma';
}

export function assignLemmaSlug(
  lemmaIast: string,
  existingSlugs: ReadonlySet<string>,
): string {
  const base = slugifyLemmaBase(lemmaIast);
  if (!existingSlugs.has(base)) return base;
  let i = 2;
  while (existingSlugs.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
