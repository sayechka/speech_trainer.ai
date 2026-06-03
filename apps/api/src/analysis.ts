import { readFile, writeFile } from "node:fs/promises"

type TranscriptWord = {
  word: string
  start: number | null
  end: number | null
  probability?: number | null
}

type TranscriptSegment = {
  start: number
  end: number
  text: string
  words?: TranscriptWord[]
}

type TranscriptJson = {
  segments: TranscriptSegment[]
  text?: string
  language?: string | null
  duration?: number | null
}

export type AnalysisJson = {
  uploadId: string

  metrics: {
    // durations
    durationSec: number
    activeSpeechSec: number
    activeSpeechMin: number

    // NEW: silence / speaking share
    initialSilenceSec: number
    finalSilenceSec: number
    speakingShare: number // activeSpeechSec/durationSec

    // words
    totalWords: number
    contentWords: number

    // NEW: lexical signals
    uniqueContentWords: number
    contentLexicalDiversity: number // uniqueContentWords/contentWords

    wordsPerMinute: number
    contentWordsPerMinute: number

    // fillers
    fillersTotal: number
    fillersUnique: number
    fillerWordCount: number
    fillerWordShare: number
    fillersPerMinute: number
    fillersPer100Words: number

    // pauses
    pausesTotal: number
    pauseTotalDuration: number
    pauseAvgDuration: number
    pauseMaxDuration: number
    pauseMedianDuration: number
    pauseP90Duration: number
    pausesPerMinute: number
    pauseTimeShare: number
    pauseThresholdSec: number

    // repetitions
    phraseRepetitionsTotal: number
    phraseRepetitionsPerMinute: number
    wordRepetitionsTotal: number
    wordRepetitionsPerMinute: number

    topFillers: Array<{
      phrase: string
      count: number
      perMinute: number
      per100Words: number
    }>

    // NEW: structuredness (segment markers)
    structureMarkersTotal: number
    structureMarkersPerMinute: number
    structureMarkerSegments: number
    structureMarkerSegmentsShare: number
    structurednessScore: number // 0..100
    topStructureMarkers: Array<{ marker: string; count: number }>

    // NEW: emotionality (heuristic)
    affectPosTotal: number
    affectNegTotal: number
    affectWordsTotal: number
    affectWordsPer100Words: number
    affectPolarity: number // -1..1 (pos-neg)/(pos+neg), 0 if too few words

    intensityWordsTotal: number
    intensityWordsPer100Words: number

    emotionalityScore: number // 0..100

    // scoring (delivery)
    overallScore: number
    overallScoreRaw: number
    reliability: number

    weights: {
      fillers: number
      repetitions: number
      pauses: number
      rate: number
    }

    subscoresRaw: {
      fillers: number
      repetitions: number
      pauses: number
      rate: number
    }

    subscores: {
      fillers: number
      repetitions: number
      pauses: number
      rate: number
    }

    losses: {
      fillers: number
      repetitions: number
      pauses: number
      rate: number
    }

    // graphs
    timeseries?: {
      rateWpm?: { stepSec: number; windowSec: number; values: Array<[number, number]> }
      loudnessDb?: { stepSec: number; windowSec: number; values: Array<[number, number]> }
    }

    // quick stats for UI
    timeseriesStats?: {
      rateWpm?: { min: number; avg: number; max: number; std: number }
      loudnessDb?: { min: number; avg: number; max: number; std: number; range: number }
    }

    // convenience
    rateWpmStd?: number
    loudnessDbStd?: number
    loudnessDbRange?: number
  }

  fillers: {
    total: number
    unique: number
    byPhrase: Record<string, number>
    occurrences: Array<{
      phrase: string
      start: number
      end: number
      segmentIndex: number
      wordIndex: number
      wordCount: number
    }>
  }

  repetitions: {
    total: number
    occurrences: Array<{
      phrase: string
      wordCount: number
      start: number
      end: number
      prevStart: number
      prevEnd: number
      distanceSeconds: number
      distanceWords: number
    }>
    config: {
      minWords: number
      maxWords: number
      maxDistanceWords: number
      maxDistanceSec: number
      minContentWords: number
    }
  }

  wordRepetitions: {
    total: number
    occurrences: Array<{
      word: string
      start: number
      end: number
      prevStart: number
      prevEnd: number
      distanceSeconds: number
      distanceWords: number
    }>
    config: {
      maxDistanceWords: number
      maxDistanceSec: number
      ignoredStopwords: number
      ignoredShortTokens: number
      ignoredBecauseFiller: number
      ignoredBecauseInPhraseRepetition: number
    }
  }

  pauses: {
    thresholdSec: number
    total: number
    totalDuration: number
    maxDuration: number
    avgDuration: number
    occurrences: Array<{
      start: number
      end: number
      duration: number
    }>
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function safeDiv(a: number, b: number) {
  return b > 0 ? a / b : 0
}

function normalizeToken(s: string) {
  return (s ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

function normalizeText(s: string) {
  return (s ?? "").toLowerCase().replaceAll("ё", "е")
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0
  const qq = clamp(q, 0, 1)
  const idx = (sorted.length - 1) * qq
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const t = idx - lo
  return sorted[lo] * (1 - t) + sorted[hi] * t
}

function stats(xs: number[]) {
  const vs = xs.filter((x) => Number.isFinite(x))
  if (!vs.length) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sumSq = 0
  for (const x of vs) {
    min = Math.min(min, x)
    max = Math.max(max, x)
    sum += x
    sumSq += x * x
  }
  const avg = sum / vs.length
  const var0 = Math.max(0, sumSq / vs.length - avg * avg)
  const std = Math.sqrt(var0)
  return { min: round1(min), avg: round1(avg), max: round1(max), std: round1(std) }
}

type FlatWord = {
  norm: string
  start: number
  end: number
  segmentIndex: number
  wordIndex: number
}

function flattenWords(t: TranscriptJson): FlatWord[] {
  const out: FlatWord[] = []
  const segments = Array.isArray(t.segments) ? t.segments : []

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]
    const words = Array.isArray(seg.words) ? seg.words : []
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi]
      if (!w) continue
      if (!isFiniteNumber(w.start) || !isFiniteNumber(w.end)) continue

      const norm = normalizeToken(String(w.word ?? ""))
      if (!norm) continue

      const safeEnd = Math.max(w.end, w.start + 0.02)

      out.push({
        norm,
        start: w.start,
        end: safeEnd,
        segmentIndex: si,
        wordIndex: wi,
      })
    }
  }

  out.sort((a, b) => a.start - b.start)
  return out
}

// ── fillers ──────────────────────────────────────────────────────────────────

const FILLER_PHRASES: string[][] = [
  ["э"],
  ["ээ"],
  ["эээ"],
  ["м"],
  ["мм"],
  ["ммм"],
  ["эм"],
  ["эмм"],
  ["эммм"],

  ["ну"],
  ["ну", "вот"],
  ["вот"],
  ["типа"],
  ["как", "бы"],
  ["то", "есть"],

  ["в", "общем"],
  ["в", "общем-то"],
  ["вообще"],
  ["в", "принципе"],
  ["по", "сути"],
  ["собственно"],

  ["короче"],
  ["коротко", "говоря"],

  ["скажем"],
  ["скажем", "так"],
  ["так", "сказать"],

  ["на", "самом", "деле"],
  ["это", "самое"],
  ["значит"],
].map((phrase) => phrase.map(normalizeToken))

function detectFillers(words: FlatWord[]) {
  const occurrences: AnalysisJson["fillers"]["occurrences"] = []
  const byPhrase: Record<string, number> = {}
  const fillerMask = new Array<boolean>(words.length).fill(false)

  for (let i = 0; i < words.length; i++) {
    for (const phraseTokens of FILLER_PHRASES) {
      const n = phraseTokens.length
      if (i + n > words.length) continue

      let ok = true
      for (let k = 0; k < n; k++) {
        if (words[i + k].norm !== phraseTokens[k]) {
          ok = false
          break
        }
      }
      if (!ok) continue

      const first = words[i]
      const last = words[i + n - 1]
      const phrase = phraseTokens.join(" ")

      occurrences.push({
        phrase,
        start: first.start,
        end: last.end,
        segmentIndex: first.segmentIndex,
        wordIndex: first.wordIndex,
        wordCount: n,
      })

      byPhrase[phrase] = (byPhrase[phrase] ?? 0) + 1
      for (let k = 0; k < n; k++) fillerMask[i + k] = true
    }
  }

  return {
    fillers: {
      total: occurrences.length,
      unique: Object.keys(byPhrase).length,
      byPhrase,
      occurrences,
    },
    fillerMask,
  }
}

// ── STOPWORDS ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  [
    "и", "а", "но", "что", "или", "ли", "либо", "да", "нет", "же", "бы", "не", "ни",
    "я", "мы", "ты", "вы", "он", "она", "оно", "они",
    "меня", "мне", "мной", "тебя", "тебе", "тобой", "нас", "нам", "нами",
    "вас", "вам", "вами", "его", "ее", "их", "ему", "ей", "им",
    "в", "во", "на", "к", "ко", "с", "со", "у", "по", "из", "от", "до", "об", "о", "про",
    "при", "за", "над", "под", "для", "без", "через", "перед", "после", "между",
    "там", "тут", "здесь", "сюда", "туда", "сейчас", "тогда",
    "это", "то", "так", "все", "всё", "еще", "ещё", "уже", "очень", "просто",
  ].map(normalizeToken)
)

// ── structure markers (structuredness) ───────────────────────────────────────

const STRUCTURE_MARKERS: Array<{ marker: string; re: RegExp }> = [
  { marker: "во-первых", re: /\bво[- ]?первых\b/giu },
  { marker: "во-вторых", re: /\bво[- ]?вторых\b/giu },
  { marker: "во-третьих", re: /\bво[- ]?третьих\b/giu },

  { marker: "первое/второе/третье", re: /\b(первое|второе|третье)\b/giu },
  { marker: "сначала/затем/потом", re: /\b(сначала|затем|потом|далее|следом)\b/giu },

  { marker: "итак", re: /\bитак\b/giu },
  { marker: "в итоге", re: /\bв\s+итоге\b/giu },
  { marker: "подводя итог", re: /\bподвед(ем|у)\s+итог\b/giu },
  { marker: "подведем итог", re: /\bподвед(ем|у)\s+итог\b/giu },
  { marker: "заключая", re: /\bрезюмир(уя|ую)\b/giu },
  { marker: "в заключение", re: /\bв\s+заключение\b/giu },

  { marker: "перейдем/переходим", re: /\bперейд(ем|у)|переходим\b/giu },
]

function computeStructuredness(segments: TranscriptSegment[], activeSpeechMin: number) {
  const segs = Array.isArray(segments) ? segments : []
  const totalSegments = segs.length

  let structureMarkersTotal = 0
  let structureMarkerSegments = 0
  const counts: Record<string, number> = {}

  for (const seg of segs) {
    const t = normalizeText(String(seg?.text ?? ""))
    if (!t.trim()) continue

    let hasAny = false
    for (const m of STRUCTURE_MARKERS) {
      // count all matches
      const matches = t.match(m.re)
      const c = matches ? matches.length : 0
      if (c > 0) {
        counts[m.marker] = (counts[m.marker] ?? 0) + c
        structureMarkersTotal += c
        hasAny = true
      }
    }
    if (hasAny) structureMarkerSegments++
  }

  const structureMarkerSegmentsShare = totalSegments > 0 ? structureMarkerSegments / totalSegments : 0
  const structureMarkersPerMinute = safeDiv(structureMarkersTotal, Math.max(1e-6, activeSpeechMin))

  // Heuristic 0..100: share of segments with markers + density per minute
  const shareN = clamp(structureMarkerSegmentsShare, 0, 1)
  const densN = clamp(structureMarkersPerMinute / 2.0, 0, 1) // ~2 markers/min => “full”
  const structurednessScore = round1(100 * clamp(0.7 * shareN + 0.3 * densN, 0, 1))

  const topStructureMarkers = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([marker, count]) => ({ marker, count }))

  return {
    structureMarkersTotal,
    structureMarkersPerMinute: round2(structureMarkersPerMinute),
    structureMarkerSegments,
    structureMarkerSegmentsShare: round2(structureMarkerSegmentsShare),
    structurednessScore,
    topStructureMarkers,
  }
}

// ── emotionality lexicon ─────────────────────────────────────────────────────

const AFFECT_POS = new Set(
  [
    "хорошо",
    "отлично",

    "рад",

    "интересно",
    "важно",
    "полезно",
  ].map(normalizeToken)
)

const AFFECT_NEG = new Set(
  [
    "плохо",
    "ужасно",

    "грустно",
  ].map(normalizeToken)
)

const INTENSIFIERS = new Set(
  ["очень", "сильно", "крайне", "максимально"].map(
    normalizeToken
  )
)

function computeEmotionality(opts: {
  totalWords: number
  pos: number
  neg: number
  intensity: number
  rateStd?: number | null
  loudStd?: number | null
  loudRange?: number | null
}) {
  const totalWords = Math.max(1, opts.totalWords)

  const affectWordsTotal = opts.pos + opts.neg
  const affectWordsPer100Words = (affectWordsTotal / totalWords) * 100
  const intensityWordsPer100Words = (opts.intensity / totalWords) * 100

  const affectPolarity =
    affectWordsTotal >= 3 ? clamp((opts.pos - opts.neg) / affectWordsTotal, -1, 1) : 0

  // Normalizations (heuristics):
  // - affect words: ~0.6..4.6 per 100 words => 0..1
  const wordN = clamp((affectWordsPer100Words - 0.6) / 4.0, 0, 1)
  const intN = clamp((intensityWordsPer100Words - 0.6) / 4.0, 0, 1)

  const hasDelivery = typeof opts.rateStd === "number" || typeof opts.loudRange === "number"

  let score01 = 0

  if (hasDelivery) {
    const rateStd = typeof opts.rateStd === "number" ? opts.rateStd : 0
    const loudRange = typeof opts.loudRange === "number" ? opts.loudRange : 0

    // - loudness range: ~4..18 dB => 0..1
    // - rate std: ~6..26 wpm => 0..1
    const loudN = clamp((loudRange - 4) / 14, 0, 1)
    const rateN = clamp((rateStd - 6) / 20, 0, 1)

    // Slight preference to acoustic expressiveness, but keep lexical affect meaningful
    score01 = clamp(0.4 * loudN + 0.25 * rateN + 0.25 * wordN + 0.1 * intN, 0, 1)
  } else {
    // No wav/timeseries => rely mostly on words
    score01 = clamp(0.75 * wordN + 0.25 * intN, 0, 1)
  }

  return {
    affectPosTotal: opts.pos,
    affectNegTotal: opts.neg,
    affectWordsTotal,
    affectWordsPer100Words: round2(affectWordsPer100Words),
    affectPolarity: round2(affectPolarity),
    intensityWordsTotal: opts.intensity,
    intensityWordsPer100Words: round2(intensityWordsPer100Words),
    emotionalityScore: round1(score01 * 100),
  }
}

// ── phrase repetitions ───────────────────────────────────────────────────────

function phraseKey(words: FlatWord[], i: number, len: number) {
  let s = words[i].norm
  for (let k = 1; k < len; k++) s += " " + words[i + k].norm
  return s
}

function hasFillerInSpan(fillerMask: boolean[], i: number, len: number) {
  for (let k = 0; k < len; k++) if (fillerMask[i + k]) return true
  return false
}

function isStopwordyPhrase(words: FlatWord[], i: number, len: number, minContentWords: number) {
  let content = 0
  for (let k = 0; k < len; k++) {
    const t = words[i + k].norm
    if (t.length >= 3 && !STOPWORDS.has(t)) content++
  }
  if (content < minContentWords) return true

  const first = words[i].norm
  const last = words[i + len - 1].norm
  if (STOPWORDS.has(first) || STOPWORDS.has(last)) return true

  return false
}

function detectPhraseRepetitions(
  words: FlatWord[],
  fillerMask: boolean[],
  opts?: {
    minWords?: number
    maxWords?: number
    maxDistanceWords?: number
    maxDistanceSec?: number
    minContentWords?: number
  }
) {
  const minWords = opts?.minWords ?? 3
  const maxWords = opts?.maxWords ?? 10
  const maxDistanceWords = opts?.maxDistanceWords ?? 40
  const maxDistanceSec = opts?.maxDistanceSec ?? 15
  const minContentWords = opts?.minContentWords ?? 2

  const occurrences: AnalysisJson["repetitions"]["occurrences"] = []
  const lastSeen = new Map<string, { idx: number; start: number; end: number }>()
  const coveredByPhrase = new Array<boolean>(words.length).fill(false)

  for (let i = 0; i <= words.length - minWords; i++) {
    let matchedLen = 0

    for (let len = Math.min(maxWords, words.length - i); len >= minWords; len--) {
      if (hasFillerInSpan(fillerMask, i, len)) continue
      if (isStopwordyPhrase(words, i, len, minContentWords)) continue

      const key = phraseKey(words, i, len)
      const prev = lastSeen.get(key)
      if (!prev) continue

      const start = words[i].start
      const end = words[i + len - 1].end
      const distanceWords = i - prev.idx
      const distanceSeconds = start - prev.end

      if (
        distanceWords >= 1 &&
        distanceWords <= maxDistanceWords &&
        distanceSeconds >= 0 &&
        distanceSeconds <= maxDistanceSec
      ) {
        occurrences.push({
          phrase: key,
          wordCount: len,
          start,
          end,
          prevStart: prev.start,
          prevEnd: prev.end,
          distanceSeconds,
          distanceWords,
        })

        for (let k = 0; k < len; k++) {
          const curIdx = i + k
          const prevIdx = prev.idx + k
          if (curIdx >= 0 && curIdx < coveredByPhrase.length) coveredByPhrase[curIdx] = true
          if (prevIdx >= 0 && prevIdx < coveredByPhrase.length) coveredByPhrase[prevIdx] = true
        }

        matchedLen = len
        break
      }
    }

    for (let len = minWords; len <= Math.min(maxWords, words.length - i); len++) {
      if (hasFillerInSpan(fillerMask, i, len)) continue
      if (isStopwordyPhrase(words, i, len, minContentWords)) continue

      const key = phraseKey(words, i, len)
      lastSeen.set(key, {
        idx: i,
        start: words[i].start,
        end: words[i + len - 1].end,
      })
    }

    if (matchedLen > 0) i += matchedLen - 1
  }

  return {
    total: occurrences.length,
    occurrences,
    coveredByPhrase,
    config: { minWords, maxWords, maxDistanceWords, maxDistanceSec, minContentWords },
  }
}

// ── word repetitions ─────────────────────────────────────────────────────────

function detectWordRepetitions(
  words: FlatWord[],
  fillerMask: boolean[],
  coveredByPhrase: boolean[],
  opts?: { maxDistanceWords?: number; maxDistanceSec?: number }
) {
  const maxDistanceWords = opts?.maxDistanceWords ?? 10
  const maxDistanceSec = opts?.maxDistanceSec ?? 6

  const occurrences: AnalysisJson["wordRepetitions"]["occurrences"] = []
  const lastSeen = new Map<string, { idx: number; start: number; end: number }>()

  let ignoredStopwords = 0
  let ignoredShortTokens = 0
  let ignoredBecauseFiller = 0
  let ignoredBecauseInPhraseRepetition = 0

  for (let i = 0; i < words.length; i++) {
    const w = words[i]

    if (coveredByPhrase[i]) {
      ignoredBecauseInPhraseRepetition++
      continue
    }
    if (fillerMask[i]) {
      ignoredBecauseFiller++
      continue
    }
    if (w.norm.length < 3) {
      ignoredShortTokens++
      continue
    }
    if (STOPWORDS.has(w.norm)) {
      ignoredStopwords++
      continue
    }
    if (/^\d+$/u.test(w.norm)) continue

    const prev = lastSeen.get(w.norm)
    if (prev) {
      const distanceWords = i - prev.idx
      const distanceSeconds = w.start - prev.end

      if (
        distanceWords >= 1 &&
        distanceWords <= maxDistanceWords &&
        distanceSeconds >= 0 &&
        distanceSeconds <= maxDistanceSec
      ) {
        occurrences.push({
          word: w.norm,
          start: w.start,
          end: w.end,
          prevStart: prev.start,
          prevEnd: prev.end,
          distanceSeconds,
          distanceWords,
        })
      }
    }

    lastSeen.set(w.norm, { idx: i, start: w.start, end: w.end })
  }

  return {
    total: occurrences.length,
    occurrences,
    config: {
      maxDistanceWords,
      maxDistanceSec,
      ignoredStopwords,
      ignoredShortTokens,
      ignoredBecauseFiller,
      ignoredBecauseInPhraseRepetition,
    },
  }
}

// ── pauses ───────────────────────────────────────────────────────────────────

function detectPauses(words: FlatWord[], thresholdSec: number) {
  const occurrences: AnalysisJson["pauses"]["occurrences"] = []

  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i]
    const b = words[i + 1]
    const gap = b.start - a.end
    if (gap >= thresholdSec) occurrences.push({ start: a.end, end: b.start, duration: gap })
  }

  const total = occurrences.length
  const totalDuration = occurrences.reduce((s, x) => s + x.duration, 0)
  const maxDuration = occurrences.reduce((m, x) => Math.max(m, x.duration), 0)
  const avgDuration = total ? totalDuration / total : 0

  return { thresholdSec, total, totalDuration, maxDuration, avgDuration, occurrences }
}

// ── timeseries (graphs) ──────────────────────────────────────────────────────

function buildRateWpmTimeseries(words: FlatWord[], durationSec: number, stepSec = 3, windowSec = 12) {
  const out: Array<[number, number]> = []
  if (!words.length || durationSec <= 0) return out

  const half = windowSec / 2
  let left = 0
  let right = 0

  for (let t = 0; t <= durationSec + 1e-6; t += stepSec) {
    const a = Math.max(0, t - half)
    const b = Math.min(durationSec, t + half)

    while (left < words.length && words[left].start < a) left++
    while (right < words.length && words[right].start < b) right++

    const count = Math.max(0, right - left)
    const wpm = (count * 60) / Math.max(0.001, b - a)
    out.push([round1(t), round1(wpm)])
  }

  return out
}

function parseWavPcm16Mono(buf: Buffer) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const u32 = (o: number) => dv.getUint32(o, true)
  const u16 = (o: number) => dv.getUint16(o, true)
  const str4 = (o: number) =>
    String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))

  if (dv.byteLength < 16) return null
  if (str4(0) !== "RIFF" || str4(8) !== "WAVE") return null

  let off = 12
  let fmt: { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number } | null = null
  let dataOff = -1
  let dataSize = 0

  while (off + 8 <= dv.byteLength) {
    const id = str4(off)
    const size = u32(off + 4)
    const body = off + 8
    if (body + size > dv.byteLength) break

    if (id === "fmt ") {
      const audioFormat = u16(body + 0)
      const numChannels = u16(body + 2)
      const sampleRate = u32(body + 4)
      const bitsPerSample = u16(body + 14)
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample }
    } else if (id === "data") {
      dataOff = body
      dataSize = size
      break
    }

    off = body + size + (size % 2)
  }

  if (!fmt || dataOff < 0) return null
  if (fmt.audioFormat !== 1) return null
  if (fmt.numChannels !== 1) return null
  if (fmt.bitsPerSample !== 16) return null

  // Ensure Int16Array alignment
  const alignedOff = dataOff % 2 === 0 ? dataOff : dataOff + 1
  const safeSize = Math.max(0, Math.min(dataSize - (alignedOff - dataOff), dv.byteLength - alignedOff))
  const sampleCount = Math.floor(safeSize / 2)
  if (sampleCount <= 0) return null

  const samples = new Int16Array(buf.buffer, buf.byteOffset + alignedOff, sampleCount)
  return { sampleRate: fmt.sampleRate, samples }
}

function buildLoudnessDbTimeseriesFromWav(wavBuf: Buffer, durationSec: number, stepSec = 3, windowSec = 6) {
  const parsed = parseWavPcm16Mono(wavBuf)
  if (!parsed) return [] as Array<[number, number]>

  const sr = parsed.sampleRate
  const samples = parsed.samples
  const totalSamples = samples.length
  if (!totalSamples) return [] as Array<[number, number]>

  const out: Array<[number, number]> = []
  const half = windowSec / 2
  const fullScale = 32768

  for (let t = 0; t <= durationSec + 1e-6; t += stepSec) {
    const aSec = Math.max(0, t - half)
    const bSec = Math.min(durationSec, t + half)

    const a = Math.max(0, Math.floor(aSec * sr))
    const b = Math.min(totalSamples, Math.floor(bSec * sr))
    const n = Math.max(1, b - a)

    let sumSq = 0
    for (let i = a; i < b; i++) {
      const x = samples[i] / fullScale
      sumSq += x * x
    }
    const rms = Math.sqrt(sumSq / n)

    let db = rms > 0 ? 20 * Math.log10(rms) : -80
    if (!Number.isFinite(db)) db = -80
    db = clamp(db, -80, 0)

    out.push([round1(t), round1(db)])
  }

  return out
}

// ── scoring ──────────────────────────────────────────────────────────────────

function highIsBadScore(x: number, good: number, bad: number, p = 1.6) {
  if (!Number.isFinite(x)) return 50
  if (bad <= good) return 50
  const t = clamp((x - good) / (bad - good), 0, 1)
  return 100 * (1 - Math.pow(t, p))
}

function rangeScore(x: number, minGood: number, maxGood: number, minBad: number, maxBad: number, p = 1.6) {
  if (!Number.isFinite(x)) return 50
  if (minBad >= minGood || maxBad <= maxGood) return 50

  if (x >= minGood && x <= maxGood) return 100

  if (x < minGood) {
    const t = clamp((minGood - x) / (minGood - minBad), 0, 1)
    return 100 * (1 - Math.pow(t, p))
  }

  const t = clamp((x - maxGood) / (maxBad - maxGood), 0, 1)
  return 100 * (1 - Math.pow(t, p))
}

const SNAP_VALUES: number[] = (() => {
  const xs: number[] = [0.0]
  for (let tens = 0; tens <= 9; tens++) {
    xs.push(tens * 10 + 3.4)
    xs.push(tens * 10 + 6.9)
  }
  xs.push(100.0)
  return Array.from(new Set(xs.map((v) => Math.round(v * 10) / 10))).sort((a, b) => a - b)
})()

function snapToNice(score: number) {
  const s = clamp(score, 0, 100)
  let best = SNAP_VALUES[0]
  let bestD = Math.abs(s - best)
  for (const v of SNAP_VALUES) {
    const d = Math.abs(s - v)
    if (d < bestD || (d === bestD && v > best)) {
      best = v
      bestD = d
    }
  }
  return best
}

const SCORE_WEIGHTS = {
  fillers: 0.35,
  repetitions: 0.25,
  pauses: 0.2,
  rate: 0.2,
} as const

type ScoreKey = keyof typeof SCORE_WEIGHTS

function computeOverallScore(input: {
  activeSpeechMin: number
  fillersPer100Words: number
  fillersPerMinute: number
  fillerWordShare: number
  phraseRepetitionsPerMinute: number
  wordRepetitionsPerMinute: number
  pausesPerMinute: number
  pauseTimeShare: number
  pauseMaxDuration: number
  wordsPerMinute: number
}) {
  const F_100 = highIsBadScore(input.fillersPer100Words, 2.0, 7.0)
  const F_min = highIsBadScore(input.fillersPerMinute, 2.5, 8.5)
  const F_share = highIsBadScore(input.fillerWordShare, 0.02, 0.08)
  const F = 0.55 * F_100 + 0.25 * F_min + 0.2 * F_share

  const R_phrase = highIsBadScore(input.phraseRepetitionsPerMinute, 0.05, 0.4)
  const R_word = highIsBadScore(input.wordRepetitionsPerMinute, 1.2, 8.0)
  const R = 0.65 * R_phrase + 0.35 * R_word

  const P_rate = highIsBadScore(input.pausesPerMinute, 0.15, 0.9)
  const P_share = highIsBadScore(input.pauseTimeShare, 0.01, 0.06)
  const P_max = highIsBadScore(input.pauseMaxDuration, 1.8, 4.0)
  const P = 0.6 * P_rate + 0.25 * P_share + 0.15 * P_max

  const S = rangeScore(input.wordsPerMinute, 110, 175, 75, 230)

  const raw =
    SCORE_WEIGHTS.fillers * F +
    SCORE_WEIGHTS.repetitions * R +
    SCORE_WEIGHTS.pauses * P +
    SCORE_WEIGHTS.rate * S

  const reliability = clamp(input.activeSpeechMin / 2, 0.25, 1)
  const finalRaw = reliability * raw + (1 - reliability) * 50

  const snapped = snapToNice(finalRaw)

  const subscoresRaw = {
    fillers: clamp(F, 0, 100),
    repetitions: clamp(R, 0, 100),
    pauses: clamp(P, 0, 100),
    rate: clamp(S, 0, 100),
  } satisfies Record<ScoreKey, number>

  const subscores = {
    fillers: Math.round(subscoresRaw.fillers),
    repetitions: Math.round(subscoresRaw.repetitions),
    pauses: Math.round(subscoresRaw.pauses),
    rate: Math.round(subscoresRaw.rate),
  } satisfies Record<ScoreKey, number>

  const losses = {
    fillers: round1(SCORE_WEIGHTS.fillers * (100 - subscoresRaw.fillers)),
    repetitions: round1(SCORE_WEIGHTS.repetitions * (100 - subscoresRaw.repetitions)),
    pauses: round1(SCORE_WEIGHTS.pauses * (100 - subscoresRaw.pauses)),
    rate: round1(SCORE_WEIGHTS.rate * (100 - subscoresRaw.rate)),
  } satisfies Record<ScoreKey, number>

  return {
    overallScore: snapped,
    overallScoreRaw: round2(finalRaw),
    reliability: round2(reliability),
    weights: SCORE_WEIGHTS,
    subscoresRaw: {
      fillers: round2(subscoresRaw.fillers),
      repetitions: round2(subscoresRaw.repetitions),
      pauses: round2(subscoresRaw.pauses),
      rate: round2(subscoresRaw.rate),
    },
    subscores,
    losses,
  }
}

// ── metrics ──────────────────────────────────────────────────────────────────

function buildMetrics(opts: {
  transcript: TranscriptJson
  words: FlatWord[]
  fillerMask: boolean[]
  fillersTotal: number
  fillersUnique: number
  fillersByPhrase: Record<string, number>
  pauses: {
    thresholdSec: number
    total: number
    totalDuration: number
    maxDuration: number
    avgDuration: number
    occurrences: Array<{ duration: number }>
  }
  phraseRepetitionsTotal: number
  wordRepetitionsTotal: number
  timeseries?: AnalysisJson["metrics"]["timeseries"]
}) {
  const { transcript, words, fillerMask } = opts
  const totalWords = words.length

  const firstWordStart = totalWords ? words[0].start : 0
  const lastWordEnd = totalWords ? words[totalWords - 1].end : 0

  const transcriptDuration = isFiniteNumber(transcript.duration) ? transcript.duration : null
  const durationSec = round2(Math.max(0, Math.max(transcriptDuration ?? 0, lastWordEnd)))

  const activeSpeechSec =
    totalWords >= 2 ? Math.max(0.001, lastWordEnd - firstWordStart) : Math.max(0.001, durationSec)
  const activeSpeechMin = activeSpeechSec / 60

  const initialSilenceSec = round2(Math.max(0, firstWordStart))
  const finalSilenceSec = round2(Math.max(0, (transcriptDuration ?? durationSec) - lastWordEnd))
  const speakingShare = round2(safeDiv(activeSpeechSec, Math.max(0.001, durationSec)))

  // Lexical
  let contentWords = 0
  const contentSet = new Set<string>()

  // Emotional lexicon counts (count all tokens, even stopwords/fillers)
  let pos = 0
  let neg = 0
  let intensity = 0

  for (let i = 0; i < words.length; i++) {
    const t = words[i].norm

    if (AFFECT_POS.has(t)) pos++
    if (AFFECT_NEG.has(t)) neg++
    if (INTENSIFIERS.has(t)) intensity++

    if (fillerMask[i]) continue
    if (t.length < 3) continue
    if (STOPWORDS.has(t)) continue
    if (/^\d+$/u.test(t)) continue

    contentWords++
    contentSet.add(t)
  }

  const uniqueContentWords = contentSet.size
  const contentLexicalDiversity = round2(safeDiv(uniqueContentWords, Math.max(1, contentWords)))

  // Fillers
  const fillerWordCount = fillerMask.reduce((s, x) => s + (x ? 1 : 0), 0)
  const fillerWordShare = safeDiv(fillerWordCount, totalWords)

  // Rates
  const wordsPerMinute = safeDiv(totalWords, activeSpeechMin)
  const contentWordsPerMinute = safeDiv(contentWords, activeSpeechMin)

  // Fillers normalized
  const fillersPerMinute = safeDiv(opts.fillersTotal, activeSpeechMin)
  const fillersPer100Words = safeDiv(opts.fillersTotal, totalWords) * 100

  // Pauses
  const pausesPerMinute = safeDiv(opts.pauses.total, activeSpeechMin)
  const pauseTimeShare = safeDiv(opts.pauses.totalDuration, activeSpeechSec)

  // Repetitions
  const phraseRepetitionsPerMinute = safeDiv(opts.phraseRepetitionsTotal, activeSpeechMin)
  const wordRepetitionsPerMinute = safeDiv(opts.wordRepetitionsTotal, activeSpeechMin)

  // Top fillers
  const topFillers = Object.entries(opts.fillersByPhrase)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({
      phrase,
      count,
      perMinute: round2(safeDiv(count, activeSpeechMin)),
      per100Words: round2(safeDiv(count, totalWords) * 100),
    }))

  // Delivery score (existing)
  const score = computeOverallScore({
    activeSpeechMin,
    fillersPer100Words,
    fillersPerMinute,
    fillerWordShare,
    phraseRepetitionsPerMinute,
    wordRepetitionsPerMinute,
    pausesPerMinute,
    pauseTimeShare,
    pauseMaxDuration: opts.pauses.maxDuration,
    wordsPerMinute,
  })

  // Pause distribution
  const pauseDurations = opts.pauses.occurrences
    .map((x) => x.duration)
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b)

  const pauseMedianDuration = round2(quantile(pauseDurations, 0.5))
  const pauseP90Duration = round2(quantile(pauseDurations, 0.9))

  // Timeseries stats
  const rateValues = opts.timeseries?.rateWpm?.values?.map((p) => p[1]) ?? []
  const loudValues = opts.timeseries?.loudnessDb?.values?.map((p) => p[1]) ?? []

  const rateStats = stats(rateValues)
  const loudStats0 = stats(loudValues)

  const timeseriesStats: AnalysisJson["metrics"]["timeseriesStats"] = {
    ...(rateStats ? { rateWpm: rateStats } : {}),
    ...(loudStats0
      ? {
          loudnessDb: {
            ...loudStats0,
            range: round1(loudStats0.max - loudStats0.min),
          },
        }
      : {}),
  }

  const loudRange = loudStats0 ? loudStats0.max - loudStats0.min : null

  // Structuredness (segment markers)
  const structured = computeStructuredness(Array.isArray(transcript.segments) ? transcript.segments : [], activeSpeechMin)

  // Emotionality (lexical + delivery variability)
  const emotional = computeEmotionality({
    totalWords,
    pos,
    neg,
    intensity,
    rateStd: rateStats?.std ?? null,
    loudStd: loudStats0?.std ?? null,
    loudRange,
  })

  return {
    durationSec,
    activeSpeechSec: round2(activeSpeechSec),
    activeSpeechMin: round2(activeSpeechMin),

    initialSilenceSec,
    finalSilenceSec,
    speakingShare,

    totalWords,
    contentWords,
    uniqueContentWords,
    contentLexicalDiversity,

    wordsPerMinute: round2(wordsPerMinute),
    contentWordsPerMinute: round2(contentWordsPerMinute),

    fillersTotal: opts.fillersTotal,
    fillersUnique: opts.fillersUnique,
    fillerWordCount,
    fillerWordShare: round2(fillerWordShare),
    fillersPerMinute: round2(fillersPerMinute),
    fillersPer100Words: round2(fillersPer100Words),

    pausesTotal: opts.pauses.total,
    pauseTotalDuration: round2(opts.pauses.totalDuration),
    pauseAvgDuration: round2(opts.pauses.avgDuration),
    pauseMaxDuration: round2(opts.pauses.maxDuration),
    pauseMedianDuration,
    pauseP90Duration,

    pausesPerMinute: round2(pausesPerMinute),
    pauseTimeShare: round2(pauseTimeShare),
    pauseThresholdSec: round2(opts.pauses.thresholdSec),

    phraseRepetitionsTotal: opts.phraseRepetitionsTotal,
    phraseRepetitionsPerMinute: round2(phraseRepetitionsPerMinute),

    wordRepetitionsTotal: opts.wordRepetitionsTotal,
    wordRepetitionsPerMinute: round2(wordRepetitionsPerMinute),

    topFillers,

    // new: structuredness
    ...structured,

    // new: emotionality
    ...emotional,

    // scoring
    ...score,

    ...(opts.timeseries ? { timeseries: opts.timeseries } : {}),
    ...(Object.keys(timeseriesStats).length ? { timeseriesStats } : {}),

    ...(rateStats ? { rateWpmStd: rateStats.std } : {}),
    ...(loudStats0
      ? { loudnessDbStd: loudStats0.std, loudnessDbRange: round1(loudStats0.max - loudStats0.min) }
      : {}),
  }
}

// ── entry ────────────────────────────────────────────────────────────────────

export async function analyzeTranscriptFile(opts: {
  uploadId: string
  transcriptJsonPath: string
  outputAnalysisJsonPath: string
  pauseThresholdSec?: number
  audioWavPath?: string
}) {
  const raw = await readFile(opts.transcriptJsonPath, "utf-8")
  const transcript = JSON.parse(raw) as TranscriptJson

  const words = flattenWords(transcript)
  const pauseThresholdSec = opts.pauseThresholdSec ?? 1.5

  const { fillers, fillerMask } = detectFillers(words)

  const phraseReps = detectPhraseRepetitions(words, fillerMask, {
    minWords: 3,
    maxWords: 10,
    maxDistanceWords: 40,
    maxDistanceSec: 15,
    minContentWords: 2,
  })

  const wordRepetitions = detectWordRepetitions(words, fillerMask, phraseReps.coveredByPhrase, {
    maxDistanceWords: 10,
    maxDistanceSec: 6,
  })

  const pauses = detectPauses(words, pauseThresholdSec)

  // duration for timeseries
  const lastWordEnd = words.length ? words[words.length - 1].end : 0
  const durationSec = Math.max(
    0,
    Math.max(isFiniteNumber(transcript.duration) ? transcript.duration : 0, lastWordEnd)
  )

  const rateStepSec = 3
  const rateWindowSec = 12
  const rateValues = buildRateWpmTimeseries(words, durationSec, rateStepSec, rateWindowSec)

  let loudnessValues: Array<[number, number]> | null = null
  const loudStepSec = 3
  const loudWindowSec = 6
  if (opts.audioWavPath) {
    try {
      const wavBuf = await readFile(opts.audioWavPath)
      loudnessValues = buildLoudnessDbTimeseriesFromWav(wavBuf, durationSec, loudStepSec, loudWindowSec)
    } catch {
      loudnessValues = null
    }
  }

  const timeseries: AnalysisJson["metrics"]["timeseries"] = {
    rateWpm: { stepSec: rateStepSec, windowSec: rateWindowSec, values: rateValues },
    ...(loudnessValues ? { loudnessDb: { stepSec: loudStepSec, windowSec: loudWindowSec, values: loudnessValues } } : {}),
  }

  const metrics = buildMetrics({
    transcript,
    words,
    fillerMask,
    fillersTotal: fillers.total,
    fillersUnique: fillers.unique,
    fillersByPhrase: fillers.byPhrase,
    pauses: {
      thresholdSec: pauses.thresholdSec,
      total: pauses.total,
      totalDuration: pauses.totalDuration,
      maxDuration: pauses.maxDuration,
      avgDuration: pauses.avgDuration,
      occurrences: pauses.occurrences,
    },
    phraseRepetitionsTotal: phraseReps.total,
    wordRepetitionsTotal: wordRepetitions.total,
    timeseries,
  })

  const analysis: AnalysisJson = {
    uploadId: opts.uploadId,
    metrics,
    fillers,
    repetitions: {
      total: phraseReps.total,
      occurrences: phraseReps.occurrences,
      config: phraseReps.config,
    },
    wordRepetitions,
    pauses,
  }

  await writeFile(opts.outputAnalysisJsonPath, JSON.stringify(analysis, null, 2), "utf-8")
  return analysis
}
