import { getLemmaRoutes, getLemmaSummaryBySlug } from '../src/lib/seo/corpus-bundle';

const seen = new Set<string>();
const duplicates: string[] = [];
const missingSummaries: string[] = [];

for (const route of getLemmaRoutes()) {
  if (seen.has(route.slug)) duplicates.push(route.slug);
  seen.add(route.slug);
  if (!getLemmaSummaryBySlug(route.slug)) missingSummaries.push(route.slug);
}

if (duplicates.length > 0 || missingSummaries.length > 0) {
  console.error('Lemma slug audit failed.');
  if (duplicates.length > 0) {
    console.error(`Duplicate slugs: ${duplicates.join(', ')}`);
  }
  if (missingSummaries.length > 0) {
    console.error(`Routes missing summaries: ${missingSummaries.join(', ')}`);
  }
  process.exit(1);
}

console.log(`Lemma slug audit passed for ${seen.size} standalone lemma routes.`);
