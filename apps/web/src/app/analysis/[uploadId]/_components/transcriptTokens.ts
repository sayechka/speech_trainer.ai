export type TokenKind =
  | "text"
  | "pause"
  | "filler"
  | "repeat-word"
  | "repeat-phrase"
  | "emotion"
  | "intensity"

export type WordToken = {
  id: string
  kind: TokenKind
  text: string
  suffix: string
  startSec: number
  endSec: number
}

export type TokenGroup = {
  startSec: number
  endSec: number
  tokens: WordToken[]
}

type TranscriptWord = { word: string; start: number | null; end: number | null; probability?: number | null }
type TranscriptSegment = { start: number; end: number; text: string; words?: TranscriptWord[] }
type TranscriptJson = { segments: TranscriptSegment[]; text?: string; language?: string | null; duration?: number | null }

type AnalysisJson = {
  fillers?: { occurrences?: Array<{ phrase: string; start: number; end: number }> }
  repetitions?: { occurrences?: Array<{ phrase: string; start: number; end: number }> }
  wordRepetitions?: { occurrences?: Array<{ word: string; start: number; end: number }> }
  pauses?: { occurrences?: Array<{ start: number; end: number; duration: number }> }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && b0 < a1
}

function normalizeToken(s: string) {
  return (s ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

// Небольшой словарь, синхронный с идеей analysis.ts (позитив/негатив + усилители)
const AFFECT_POS = new Set(
  ["хорошо", "отлично", "рад", "интересно", "полезно", "важно", "нравится", "преимущество", "преимущества"].map(
    normalizeToken
  )
)

const AFFECT_NEG = new Set(
  ["плохо", "ужасно", "грустно", "проблема", "проблемы", "ошибка", "ошибки"].map(normalizeToken)
)

const INTENSIFIERS = new Set(["очень", "крайне", "максимально", "сильно", "реально"].map(normalizeToken))

export function buildTokens(transcript: TranscriptJson, analysis: AnalysisJson): WordToken[] {
  let idCounter = 0
  const wordTokens: WordToken[] = []

  for (const seg of transcript.segments ?? []) {
    const ws = Array.isArray(seg.words) ? seg.words : []
    for (const w of ws) {
      const a = typeof w.start === "number" ? w.start : null
      const b = typeof w.end === "number" ? w.end : null
      if (a == null || b == null) continue

      const txt = String(w.word ?? "").trim()
      if (!txt) continue

      wordTokens.push({
        id: `w-${idCounter++}`,
        kind: "text",
        text: txt,
        suffix: " ",
        startSec: a,
        endSec: Math.max(b, a + 0.01),
      })
    }
  }

  const pauseTokens: WordToken[] = (analysis.pauses?.occurrences ?? []).map((p) => ({
    id: `p-${idCounter++}`,
    kind: "pause",
    text: "",
    suffix: " ",
    startSec: p.start,
    endSec: Math.max(p.end, p.start + 0.01),
  }))

  const merged = [...wordTokens, ...pauseTokens].sort((a, b) => a.startSec - b.startSec)

  const fillerOcc = analysis.fillers?.occurrences ?? []
  const phraseOcc = analysis.repetitions?.occurrences ?? []
  const wordOcc = analysis.wordRepetitions?.occurrences ?? []

  return merged.map((t) => {
    // priority: pauses > fillers/repeats > intensity > emotion > text
    if (t.kind === "pause") return t

    if (fillerOcc.some((o) => overlap(t.startSec, t.endSec, o.start, o.end))) return { ...t, kind: "filler" as const }
    if (wordOcc.some((o) => overlap(t.startSec, t.endSec, o.start, o.end))) return { ...t, kind: "repeat-word" as const }
    if (phraseOcc.some((o) => overlap(t.startSec, t.endSec, o.start, o.end))) return { ...t, kind: "repeat-phrase" as const }

    const norm = normalizeToken(t.text)
    if (norm && INTENSIFIERS.has(norm)) return { ...t, kind: "intensity" as const }
    if (norm && (AFFECT_POS.has(norm) || AFFECT_NEG.has(norm))) return { ...t, kind: "emotion" as const }

    return t
  })
}

export function groupTokensByBuckets(tokens: WordToken[], durationSec: number, bucketSec: number): TokenGroup[] {
  const BUCKET = Math.max(5, Math.floor(bucketSec || 30))
  const dur = Math.max(0, durationSec || 0)

  const count = Math.max(1, Math.ceil(dur / BUCKET))
  const groups: TokenGroup[] = Array.from({ length: count }, (_, i) => ({
    startSec: i * BUCKET,
    endSec: Math.min(dur, (i + 1) * BUCKET),
    tokens: [],
  }))

  const maxStart = Math.max(0, dur - 1e-6)

  for (const tok of tokens) {
    const a = clamp(tok.startSec, 0, maxStart)
    const idx = clamp(Math.floor(a / BUCKET), 0, count - 1)
    groups[idx].tokens.push(tok)
  }

  for (const g of groups) g.tokens.sort((x, y) => x.startSec - y.startSec)
  return groups
}
