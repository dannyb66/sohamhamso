import type { Text } from '../../db';

export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return (
    input.text.description ??
    `${input.text.title_en} in the ${input.text.tradition} tradition, ${input.totalVerses} verses.`
  );
}
