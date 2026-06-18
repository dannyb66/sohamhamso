/**
 * JSON serialization that is safe to inline inside a <script> element.
 *
 * `JSON.stringify` does NOT escape `<`, so corpus-derived strings (which are
 * third-party sourced: GRETIL, Muktabodha, volunteer transcriptions) can
 * contain `</script><script>...` and break out of the surrounding script
 * element when injected via `set:html`. That is a stored-XSS vector.
 *
 * INVARIANT: the returned string contains no literal `<` (every occurrence is
 * escaped as `\u003c`) and no raw U+2028/U+2029 line separators (legal in
 * JSON but line terminators in classic JS contexts). It is therefore safe to
 * embed in `<script>` bodies and `<script type="application/ld+json">`
 * blocks. Every `set:html={...JSON...}` sink MUST go through this function.
 */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
