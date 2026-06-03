"use client"

import { useMemo, useRef } from "react"
import type { PointerEvent } from "react"

type Timeseries = { stepSec: number; windowSec: number; values: Array<[number, number]> }

type AnalysisJson = {
  metrics?: {
    timeseries?: {
      rateWpm?: Timeseries
      loudnessDb?: Timeseries
    }
  }
  fillers?: { occurrences?: Array<{ start: number; end: number }> }
  wordRepetitions?: { occurrences?: Array<{ start: number; end: number }> }
  repetitions?: { occurrences?: Array<{ start: number; end: number }> }
  pauses?: { occurrences?: Array<{ start: number; end: number; duration: number }> }
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function nearestValue(values: Array<[number, number]>, t: number) {
  let best: number | null = null
  let bestD = Infinity
  for (const [tt, vv] of values) {
    if (!Number.isFinite(tt) || !Number.isFinite(vv)) continue
    const d = Math.abs(tt - t)
    if (d < bestD) {
      bestD = d
      best = vv
    }
  }
  return best
}

function makePath(values: Array<[number, number]>, durationSec: number, yMin: number, yMax: number) {
  const W = 1000
  const H = 100
  const yPad = 6

  const denT = Math.max(1e-6, durationSec)
  const denY = Math.max(1e-6, yMax - yMin)

  let d = ""
  let started = false

  for (let i = 0; i < values.length; i++) {
    const [t, v] = values[i]
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      started = false
      continue
    }

    const x = clamp((t / denT) * W, 0, W)
    const y0 = (v - yMin) / denY
    const y = clamp(yPad + (1 - y0) * (H - 2 * yPad), yPad, H - yPad)

    if (!started) {
      d += `M ${x.toFixed(2)} ${y.toFixed(2)}`
      started = true
    } else {
      d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`
    }
  }

  return d
}

function domain(values: Array<[number, number]>, pad = 0.06) {
  let min = Infinity
  let max = -Infinity
  for (const [, v] of values) {
    if (!Number.isFinite(v)) continue
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (min === max) return { min: min - 1, max: max + 1 }
  const r = max - min
  return { min: min - r * pad, max: max + r * pad }
}

function sampleTimes(xs: number[], limit: number) {
  if (xs.length <= limit) return xs
  const out: number[] = []
  for (let i = 0; i < limit; i++) {
    const t = i / (limit - 1)
    out.push(xs[Math.floor(t * (xs.length - 1))])
  }
  return out
}

function MiniChart(opts: {
  title: string
  unit: string
  color: string
  values: Array<[number, number]>
  durationSec: number
  currentTimeSec: number

  pauses: Array<{ start: number; end: number }>
  fillerStarts: number[]
  wordRepStarts: number[]
  phraseRepStarts: number[]

  onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { min, max } = useMemo(() => domain(opts.values), [opts.values])

  const path = useMemo(
    () => makePath(opts.values, opts.durationSec, min, max),
    [opts.values, opts.durationSec, min, max]
  )

  const curVal = useMemo(
    () => nearestValue(opts.values, opts.currentTimeSec),
    [opts.values, opts.currentTimeSec]
  )

  const xCurrent = useMemo(() => {
    const W = 1000
    const denT = Math.max(1e-6, opts.durationSec)
    return clamp((opts.currentTimeSec / denT) * W, 0, W)
  }, [opts.currentTimeSec, opts.durationSec])

  const pauseRects = useMemo(() => {
    const W = 1000
    const denT = Math.max(1e-6, opts.durationSec)
    return opts.pauses
      .filter((p) => isNum(p.start) && isNum(p.end) && p.end > p.start)
      .slice(0, 300)
      .map((p) => {
        const x1 = clamp((p.start / denT) * W, 0, W)
        const x2 = clamp((p.end / denT) * W, 0, W)
        return { x: x1, w: Math.max(1, x2 - x1) }
      })
  }, [opts.pauses, opts.durationSec])

  const filler = useMemo(() => sampleTimes(opts.fillerStarts, 220), [opts.fillerStarts])
  const wreps = useMemo(() => sampleTimes(opts.wordRepStarts, 220), [opts.wordRepStarts])
  const preps = useMemo(() => sampleTimes(opts.phraseRepStarts, 160), [opts.phraseRepStarts])

  const tickXs = useMemo(() => {
    const W = 1000
    const denT = Math.max(1e-6, opts.durationSec)
    const map = (t: number) => clamp((t / denT) * W, 0, W)
    return {
      filler: filler.map(map),
      wreps: wreps.map(map),
      preps: preps.map(map),
    }
  }, [filler, wreps, preps, opts.durationSec])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const frac = clamp(x / Math.max(1, r.width), 0, 1)
    const t = frac * opts.durationSec
    opts.onSeek(t)
  }

  return (
    <div className="min-h-0 h-full flex flex-col select-none">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[12px] font-semibold text-foreground">{opts.title}</div>
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {curVal == null ? "—" : `${curVal.toFixed(0)} ${opts.unit}`}
        </div>
      </div>

      <div
        ref={ref}
        className={[
          "mt-1 w-full cursor-pointer",
          "min-h-[84px] flex-1",
          "overflow-hidden rounded-md",
          "border border-border/60 bg-muted/5",
          "hover:bg-muted/10 transition-colors",
        ].join(" ")}
        onPointerDown={onPointerDown}
        role="button"
        aria-label={`График: ${opts.title}`}
        title="Кликните по графику, чтобы перейти к моменту"
      >
        <svg viewBox="0 0 1000 100" className="h-full w-full">
          {/* pauses spans */}
          {pauseRects.map((p, i) => (
            <rect key={i} x={p.x} y={0} width={p.w} height={100} fill="rgb(34 211 238 / 0.06)" />
          ))}

          {/* series */}
          {path ? <path d={path} fill="none" stroke={opts.color} strokeWidth={2} opacity={0.9} /> : null}

          {/* event ticks */}
          {tickXs.filler.map((x, i) => (
            <line
              key={`f-${i}`}
              x1={x}
              x2={x}
              y1={78}
              y2={98}
              stroke="rgb(248 113 113 / 0.65)"
              strokeWidth={2}
            />
          ))}
          {tickXs.wreps.map((x, i) => (
            <line
              key={`w-${i}`}
              x1={x}
              x2={x}
              y1={60}
              y2={98}
              stroke="rgb(250 204 21 / 0.55)"
              strokeWidth={2}
            />
          ))}
          {tickXs.preps.map((x, i) => (
            <line
              key={`p-${i}`}
              x1={x}
              x2={x}
              y1={66}
              y2={98}
              stroke="rgb(251 146 60 / 0.55)"
              strokeWidth={2}
            />
          ))}

          {/* current time */}
          <line
            x1={xCurrent}
            x2={xCurrent}
            y1={0}
            y2={100}
            stroke="rgb(255 255 255 / 0.55)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        </svg>
      </div>
    </div>
  )
}

export default function GraphsPanel(opts: {
  analysis: AnalysisJson | null
  analysisError: string | null
  durationSec: number
  currentTimeSec: number
  onSeek: (t: number) => void
}) {
  if (opts.analysisError) {
    return <div className="p-4 text-xs text-muted-foreground">Ошибка: {opts.analysisError}</div>
  }

  if (!opts.analysis) {
    return <div className="p-4 text-xs text-muted-foreground">Загрузка…</div>
  }

  const rate = opts.analysis.metrics?.timeseries?.rateWpm?.values ?? []
  const loud = opts.analysis.metrics?.timeseries?.loudnessDb?.values ?? []

  const pauses = (opts.analysis.pauses?.occurrences ?? [])
    .map((p) => ({ start: p.start, end: p.end }))
    .filter((p) => isNum(p.start) && isNum(p.end) && p.end > p.start)

  const fillerStarts = (opts.analysis.fillers?.occurrences ?? [])
    .map((o) => o.start)
    .filter((t): t is number => isNum(t))

  const wordRepStarts = (opts.analysis.wordRepetitions?.occurrences ?? [])
    .map((o) => o.start)
    .filter((t): t is number => isNum(t))

  const phraseRepStarts = (opts.analysis.repetitions?.occurrences ?? [])
    .map((o) => o.start)
    .filter((t): t is number => isNum(t))

  // Emotionality (client-side derived): variability of rate + loudness
  const emotional = useMemo(() => {
    if (!rate.length) return [] as Array<[number, number]>

    const rVals = rate.map((p) => p[1]).filter(Number.isFinite)
    const rAvg = rVals.length ? rVals.reduce((s, x) => s + x, 0) / rVals.length : 0
    const rVar = rVals.length ? rVals.reduce((s, x) => s + (x - rAvg) ** 2, 0) / rVals.length : 0
    const rStd = Math.sqrt(Math.max(1e-6, rVar))

    const hasLoud = loud.length > 2
    const lVals = loud.map((p) => p[1]).filter(Number.isFinite)
    const lAvg = lVals.length ? lVals.reduce((s, x) => s + x, 0) / lVals.length : -40
    let lRange = 0
    if (lVals.length) {
      let mn = Infinity
      let mx = -Infinity
      for (const v of lVals) {
        mn = Math.min(mn, v)
        mx = Math.max(mx, v)
      }
      lRange = Math.max(1e-6, mx - mn)
    }

    const loudNearest = (t: number) => (loud.length ? nearestValue(loud, t) : null)

    return rate.map(([t, r]) => {
      const rN = clamp(Math.abs(r - rAvg) / Math.max(1, rStd * 2.2), 0, 1)
      if (!hasLoud) return [t, Math.round(100 * rN)] as [number, number]

      const l0 = loudNearest(t)
      const lN = l0 == null ? 0 : clamp(Math.abs(l0 - lAvg) / Math.max(1, lRange * 0.45), 0, 1)

      const score = clamp(0.55 * lN + 0.45 * rN, 0, 1)
      return [t, Math.round(100 * score)] as [number, number]
    })
  }, [rate, loud])

  return (
    <div className="h-full min-h-0 p-4 flex flex-col">
      {/* header + legend */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-semibold text-foreground">Графики</div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm border border-cyan-400/40 bg-cyan-400/15" />
            паузы
          </span>

          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: "rgb(248 113 113 / 0.75)" }} />
            паразиты
          </span>

          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: "rgb(250 204 21 / 0.65)" }} />
            повт. слова
          </span>

          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: "rgb(251 146 60 / 0.65)" }} />
            повт. фразы
          </span>
        </div>
      </div>

      {/* charts fill available height */}
      <div className="mt-2 grid min-h-0 flex-1 grid-rows-3 gap-4">
        <MiniChart
          title="Темп"
          unit="сл/мин"
          color="rgb(34 197 94 / 0.9)"
          values={rate}
          durationSec={opts.durationSec}
          currentTimeSec={opts.currentTimeSec}
          pauses={pauses}
          fillerStarts={fillerStarts}
          wordRepStarts={wordRepStarts}
          phraseRepStarts={phraseRepStarts}
          onSeek={opts.onSeek}
        />

        <MiniChart
          title="Громкость"
          unit="dB"
          color="rgb(59 130 246 / 0.9)"
          values={loud}
          durationSec={opts.durationSec}
          currentTimeSec={opts.currentTimeSec}
          pauses={pauses}
          fillerStarts={fillerStarts}
          wordRepStarts={wordRepStarts}
          phraseRepStarts={phraseRepStarts}
          onSeek={opts.onSeek}
        />

        <MiniChart
          title="Эмоциональность"
          unit="/100"
          color="rgb(168 85 247 / 0.9)"
          values={emotional}
          durationSec={opts.durationSec}
          currentTimeSec={opts.currentTimeSec}
          pauses={pauses}
          fillerStarts={fillerStarts}
          wordRepStarts={wordRepStarts}
          phraseRepStarts={phraseRepStarts}
          onSeek={opts.onSeek}
        />
      </div>

      {!loud.length && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          Громкость: нет данных (если нужно — дотянем генерацию loudnessDb на бэке).
        </div>
      )}
    </div>
  )
}
