# YouTube Shorts — preview samples

Visual-QA previews rendered by `bun run youtube:render-samples` (real composition
+ Google TTS, no R2/DB). A length-spread of real verses from shortest translation
to the corpus maximum (332 chars), to eyeball layout + audio timing across the range.

The `.mp4` files are **gitignored** (binary, regenerable) — run the command to
recreate them locally, or remove the ignore rule if you want them committed.

| File | Text · verse | Translation len | Duration |
|------|--------------|-----------------|----------|
| `siva-sutras-3.9.mp4` | Śiva Sūtra 3.9 | 21 chars | 8.0s (floor) |
| `siva-sutras-2.1.mp4` | Śiva Sūtra 2.1 | 53 | 8.0s |
| `siva-sutras-3.4.mp4` | Śiva Sūtra 3.4 | 79 | 8.0s |
| `siva-sutras-1.16.mp4` | Śiva Sūtra 1.16 | 104 | 9.2s |
| `pratyabhijna-hrdayam-1.9.mp4` | Pratyabhijñāhṛdayam 1.9 | 133 | 10.7s |
| `spanda-karikas-1.25.mp4` | Spandakārikā 1.25 | 161 | 12.1s |
| `pratyabhijna-hrdayam-1.20.mp4` | Pratyabhijñāhṛdayam 1.20 | 332 (corpus max) | 21.3s |

## What to confirm
- **Duration scales** with narration (8s floor → 21.3s for the longest).
- **Audio starts at ~1.5s** (when the English fades in), silent before.
- **No footer overlap**, translation fits, footer is a single line.
- **Devanāgarī long compounds wrap** (don't clip at the screen edges) on 1.20.
- Devanāgarī conjuncts + IAST diacritics render correctly (no tofu).

Regenerate: `bun run youtube:render-samples --out=samples --count=7`
