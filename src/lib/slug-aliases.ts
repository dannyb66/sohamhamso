/** Pure slug-alias data safe to import in build, browser, and edge code. */
export const SLUG_ALIASES: Record<string, string> = {
  'pratyabhijna-hridayam': 'pratyabhijna-hrdayam',
  'shiva-sutras': 'siva-sutras',
  'karpura-adi-stotra': 'karpuradi-stotra',
  'karpuradi-stotram': 'karpuradi-stotra',
  'karpuuradi-stotra': 'karpuradi-stotra',
  'vijnan-bhairava-tantra': 'vijnana-bhairava-tantra',
  'vijnana-bhairava': 'vijnana-bhairava-tantra',
  'spanda-karika': 'spanda-karikas',
  paratrishika: 'paratrisika',
  paratrimsika: 'paratrisika',
  paratrimshika: 'paratrisika',
  'para-trisika': 'paratrisika',
  'ishvarapratyabhijna-karika': 'isvarapratyabhijna-karika',
  'isvara-pratyabhijna-karika': 'isvarapratyabhijna-karika',
  'ishvara-pratyabhijna-karika': 'isvarapratyabhijna-karika',
  'isvarapratyabhijna-karikas': 'isvarapratyabhijna-karika',
  'ishvarapratyabhijna-karikas': 'isvarapratyabhijna-karika',
  isvarapratyabhijna: 'isvarapratyabhijna-karika',
  ishvarapratyabhijna: 'isvarapratyabhijna-karika',
  gitarthasamgraha: 'gitartha-samgraha',
  gitarthasangraha: 'gitartha-samgraha',
  'gita-artha-samgraha': 'gitartha-samgraha',
  'gitartha-sangraha': 'gitartha-samgraha',
  bhagavadgitarthasamgraha: 'gitartha-samgraha',
  'tantra-sara': 'tantrasara',
  tantrasaram: 'tantrasara',
  'mahanirvana-tantram': 'mahanirvana-tantra',
  'maha-nirvana-tantra': 'mahanirvana-tantra',
};

export function resolveVerseAlias(
  tradition: string,
  textSlug: string,
  texts: ReadonlyArray<{ slug: string; tradition: string }>,
): { canonical: boolean; canonicalTradition: string; canonicalSlug: string } | null {
  const canonicalSlug = SLUG_ALIASES[textSlug] ?? textSlug;
  const text = texts.find((item) => item.slug === canonicalSlug);
  if (!text) return null;
  return {
    canonical: text.tradition === tradition && text.slug === textSlug,
    canonicalTradition: text.tradition,
    canonicalSlug: text.slug,
  };
}
