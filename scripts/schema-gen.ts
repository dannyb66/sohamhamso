import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusDocumentJsonSchema } from '../src/lib/seo/corpus-schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_JSON_PATH = path.resolve(__dirname, '..', 'data', 'corpus', 'schema.json');

/** Render the corpus document JSON Schema exactly as committed at data/corpus/schema.json. */
export function renderCorpusSchemaJson(): string {
  return `${JSON.stringify(corpusDocumentJsonSchema, null, 2)}\n`;
}

export async function writeCorpusSchemaJson(): Promise<string> {
  await writeFile(SCHEMA_JSON_PATH, renderCorpusSchemaJson(), 'utf8');
  return SCHEMA_JSON_PATH;
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentModulePath = fileURLToPath(import.meta.url);

if (entrypointPath === currentModulePath) {
  const written = await writeCorpusSchemaJson();
  console.log(`Wrote ${written}`);
}
