"use client"

import { useMemo } from "react"

type AnalysisJson = {
  metrics?: {
    overallScoreWithAi?: number
    overallScoreDelivery?: number
    overallScore?: number
    contentScore10?: number
    subscores?: { fillers: number; repetitions: number; pauses: number; rate: number }
    losses?: { fillers: number; repetitions: number; pauses: number; rate: number }
    fillersPer100Words?: number
    phraseRepetitionsPerMinute?: number
    wordRepetitionsPerMinute?: number
    pausesPerMinute?: number
    pauseMaxDuration?: number
    wordsPerMinute?: number
  }
  fillers?: { occurrences?: Array<{ phrase: string; start: number; end: number }> }
  wordRepetitions?: { occurrences?: Array<{ word: string; start: number; end: number }> }
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

function clamp0to100(x: number) {
  return Math.max(0, Math.min(100, x))
}

function ProgressBar({ value }: { value: number | null }) {
  const pct = value == null ? 0 : clamp0to100(value)
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full bg-white/70 transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function ScorePanel(opts: {
  analysis: AnalysisJson | null
  analysisError: string | null
  onSeek: (t: number) => void
}) {
  const m = opts.analysis?.metrics ?? null

  const overallScore = useMemo(() => {
    if (!m) return null
    if (isNum(m.overallScoreWithAi)) return m.overallScoreWithAi
    if (isNum(m.overallScore)) return m.overallScore
    return null
  }, [m])

  const deliveryScore = useMemo(() => {
    if (!m) return null
    if (isNum(m.overallScoreDelivery)) return m.overallScoreDelivery
    if (isNum(m.overallScore)) return m.overallScore
    return null
  }, [m])

  const contentScore10 = useMemo(() => {
    if (!m) return null
    return isNum(m.contentScore10) ? m.contentScore10 : null
  }, [m])

  const fillerItems = useMemo(() => {
    const occ = opts.analysis?.fillers?.occurrences ?? []
    const by = new Map<string, { phrase: string; count: number; firstStart: number }>()
    for (const o of occ) {
      const phrase = String(o.phrase ?? "").trim()
      if (!phrase) continue
      const start = isNum(o.start) ? o.start : 0
      const cur = by.get(phrase)
      if (!cur) by.set(phrase, { phrase, count: 1, firstStart: start })
      else { cur.count += 1; cur.firstStart = Math.min(cur.firstStart, start) }
    }
    return Array.from(by.values())
      .sort((a, b) => b.count - a.count || a.firstStart - b.firstStart)
      .slice(0, 3)
  }, [opts.analysis])

  const repeatWordItems = useMemo(() => {
    const occ = opts.analysis?.wordRepetitions?.occurrences ?? []
    const by = new Map<string, { word: string; count: number; firstStart: number }>()
    for (const o of occ) {
      const word = String(o.word ?? "").trim()
      if (!word) continue
      const start = isNum(o.start) ? o.start : 0
      const cur = by.get(word)
      if (!cur) by.set(word, { word, count: 1, firstStart: start })
      else { cur.count += 1; cur.firstStart = Math.min(cur.firstStart, start) }
    }
    return Array.from(by.values())
      .sort((a, b) => b.count - a.count || a.firstStart - b.firstStart)
      .slice(0, 3)
  }, [opts.analysis])

  const breakdown = useMemo(() => {
    const subs = m?.subscores ?? null
    const loss = m?.losses ?? null

    // hint: самые важные значения под каждой метрикой
    const fillersHint = isNum(m?.fillersPer100Words)
      ? `${m!.fillersPer100Words!.toFixed(1)} на 100 слов`
      : null

    const repetitionsHint = (() => {
      const parts: string[] = []
      if (isNum(m?.wordRepetitionsPerMinute))
        parts.push(`${m!.wordRepetitionsPerMinute!.toFixed(1)} сл/мин`)
      if (isNum(m?.phraseRepetitionsPerMinute))
        parts.push(`${m!.phraseRepetitionsPerMinute!.toFixed(2)} фр/мин`)
      return parts.length ? parts.join(" · ") : null
    })()

    const pausesHint = (() => {
      const parts: string[] = []
      if (isNum(m?.pausesPerMinute))
        parts.push(`${m!.pausesPerMinute!.toFixed(1)}/мин`)
      if (isNum(m?.pauseMaxDuration))
        parts.push(`макс ${m!.pauseMaxDuration!.toFixed(1)}с`)
      return parts.length ? parts.join(" · ") : null
    })()

    const rateHint = isNum(m?.wordsPerMinute)
      ? `${m!.wordsPerMinute!.toFixed(0)} сл/мин`
      : null

    return [
      { key: "fillers"     as const, label: "Паразиты", dot: "bg-red-400",    sub: subs?.fillers     ?? null, lost: loss?.fillers     ?? null, hint: fillersHint },
      { key: "repetitions" as const, label: "Повторы",  dot: "bg-yellow-400", sub: subs?.repetitions ?? null, lost: loss?.repetitions ?? null, hint: repetitionsHint },
      { key: "pauses"      as const, label: "Паузы",    dot: "bg-cyan-400",   sub: subs?.pauses      ?? null, lost: loss?.pauses      ?? null, hint: pausesHint },
      { key: "rate"        as const, label: "Темп",     dot: "bg-green-400",  sub: subs?.rate        ?? null, lost: loss?.rate        ?? null, hint: rateHint },
    ]
  }, [m])

  const advice = useMemo(() => {
    const loss = m?.losses
    if (!loss) return null
    const candidates = (["fillers", "repetitions", "pauses", "rate"] as const)
      .map((key) => ({ key, lost: loss[key] }))
      .filter((c): c is { key: typeof c.key; lost: number } => isNum(c.lost))
      .sort((a, b) => b.lost - a.lost)
    const worst = candidates[0]
    if (!worst || worst.lost <= 0) return null

    const textByKey: Record<typeof worst.key, string> = {
      fillers:     "Сосредоточьтесь на словах‑паразитах.",
      repetitions: "Сосредоточьтесь на повторах.",
      pauses:      "Сосредоточьтесь на паузах.",
      rate:        "Сосредоточьтесь на темпе речи.",
    }

    return { ...worst, text: textByKey[worst.key] }
  }, [m?.losses])

  const chipBase =
    "inline-flex items-center gap-1 rounded border px-1.5 py-[2px] " +
    "text-[10px] leading-none whitespace-nowrap cursor-pointer select-none transition-colors"

  const chipFiller =
    chipBase + " border-dashed text-red-200 bg-red-500/10 border-red-400/50 hover:bg-red-500/20"

  const chipRepeat =
    chipBase + " border-dashed text-yellow-200 bg-yellow-500/10 border-yellow-400/50 hover:bg-yellow-500/20"

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border">
      {opts.analysisError ? (
        <div className="p-4 text-xs text-muted-foreground">Ошибка: {opts.analysisError}</div>
      ) : !opts.analysis ? (
        <div className="p-4 text-xs text-muted-foreground">Загрузка…</div>
      ) : (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_1.6fr]">

          {/* ── LEFT ── */}
          <div className="flex h-full min-h-0 flex-col p-5">
            <div>
              {overallScore == null ? (
                <div className="text-6xl font-bold tabular-nums">—</div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-6xl font-bold tabular-nums">{overallScore.toFixed(1)}</span>
                  <span className="text-2xl font-bold text-muted-foreground">/100</span>
                </div>
              )}

              {(deliveryScore != null || contentScore10 != null) && (
                <p className="mt-4 text-[10px] tabular-nums text-muted-foreground/80">
                  {deliveryScore != null ? `Подача: ${deliveryScore.toFixed(1)}/100` : "Подача: —"}
                  {" · "}
                  {contentScore10 != null ? `Содержание: ${contentScore10.toFixed(1)}/10` : "Содержание: —"}
                </p>
              )}
            </div>

            <div className="my-4 h-px w-full bg-border" />

            <div className="flex flex-col gap-1">
              <p className="text-[12px] font-semibold text-foreground">Главный совет</p>
              <p className="text-[12px] text-foreground/80">
                {advice ? advice.text : "Недостаточно данных для совета."}
              </p>
              {advice && (
                <p className="text-[12px] text-green-400/80">
                  До +{advice.lost.toFixed(1)} баллов к оценке!
                </p>
              )}
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div className="flex h-full min-h-0 flex-col justify-between border-t border-border py-4 pl-4 pr-4 lg:border-l lg:border-t-0">
            {breakdown.map((r) => {
              const score = r.sub
              const lost  = r.lost
              const chips =
                r.key === "fillers"     ? fillerItems    :
                r.key === "repetitions" ? repeatWordItems : []

              return (
                <div key={r.key} className="flex min-w-0 flex-col gap-0.5">

                  {/* строка: кружок · название · бар · XX/100 −XX */}
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={["h-2 w-2 shrink-0 rounded-full", r.dot].join(" ")} />

                    <span className="shrink-0 text-[12px] font-medium text-foreground">
                      {r.label}
                    </span>

                    <div className="min-w-0 flex-1">
                      <ProgressBar value={score} />
                    </div>

                    <div className="shrink-0 tabular-nums">
                      <span className="text-[12px] text-foreground">
                        {score != null ? `${score}/100` : "—/100"}
                      </span>
                      <span className="ml-1 text-[10px] text-red-400">
                        {lost != null ? `−${lost.toFixed(1)}` : ""}
                      </span>
                    </div>
                  </div>

                  {/* hint — полезная статистика */}
                  {r.hint && (
                    <p className="text-[10px] leading-none text-foreground/80">
                      {r.hint}
                    </p>
                  )}

                  {/* топ-3 в одну строку */}
                  {chips.length > 0 && (
                    <div className="mt-1 flex flex-nowrap gap-1 overflow-hidden">
                      {chips.map((x) => {
                        const label = "phrase" in x ? x.phrase : (x as { word: string }).word
                        const count = x.count
                        const start = x.firstStart
                        return (
                          <button
                            key={label}
                            type="button"
                            className={r.key === "fillers" ? chipFiller : chipRepeat}
                            onClick={() => opts.onSeek(start)}
                            title={formatTime(start)}
                          >
                            «{label}»<span className="opacity-60"> ×{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                </div>
              )
            })}
          </div>

        </div>
      )}
    </div>
  )
}
