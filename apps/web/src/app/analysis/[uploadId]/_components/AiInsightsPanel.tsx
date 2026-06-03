"use client"

type AiInsights = {
  thesis?: string
  keyPoints?: string[]

  contentScores?: {
    clarity?: number
    structure?: number
    argumentation?: number
    focus?: number
    terminology?: number
    takeaway?: number
  }
  contentScore10?: number
  confidence?: number
  scoreRationale?: string

  outline?: Array<{
    title?: string
    gist?: string
    startSec?: number | null
    endSec?: number | null
  }>

  evidence?: Array<{
    relatesTo?: "clarity" | "structure" | "argumentation" | "focus" | "terminology" | "takeaway"
    quote?: string
    startSec?: number | null
    endSec?: number | null
    whyItMatters?: string
    fix?: string
  }>

  summary?: string
  strengths?: string[]
  improvements?: string[]
  exercises?: string[]
}

type AnalysisJson = {
  ai?: AiInsights
}

function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

function ruRelatesTo(k: string | null | undefined) {
  switch (k) {
    case "clarity":
      return "Ясность"
    case "structure":
      return "Структура"
    case "argumentation":
      return "Аргументация"
    case "focus":
      return "Фокус"
    case "terminology":
      return "Терминология"
    case "takeaway":
      return "Вывод"
    default:
      return "Пункт"
  }
}

export default function AiInsightsPanel(opts: {
  analysis: AnalysisJson | null
  analysisError: string | null
  onSeek: (t: number) => void
}) {
  if (opts.analysisError) {
    return <div className="p-4 text-xs text-muted-foreground">Ошибка: {opts.analysisError}</div>
  }

  if (!opts.analysis) {
    return <div className="p-4 text-xs text-muted-foreground">Загрузка…</div>
  }

  const ai = opts.analysis?.ai ?? null
  if (!ai) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Разбор от ИИ пока не готов.
      </div>
    )
  }

  const scores = ai.contentScores ?? {}
  const scoreRows = [
    { key: "clarity", label: "Ясность", v: scores.clarity },
    { key: "structure", label: "Структура", v: scores.structure },
    { key: "argumentation", label: "Аргументация", v: scores.argumentation },
    { key: "focus", label: "Фокус", v: scores.focus },
    { key: "terminology", label: "Терминология", v: scores.terminology },
    { key: "takeaway", label: "Вывод", v: scores.takeaway },
  ] as const

  const outline = Array.isArray(ai.outline) ? ai.outline : []
  const evidence = Array.isArray(ai.evidence) ? ai.evidence : []

  const strengths = Array.isArray(ai.strengths) ? ai.strengths : []
  const improvements = Array.isArray(ai.improvements) ? ai.improvements : []
  const exercises = Array.isArray(ai.exercises) ? ai.exercises : []

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      {/* ── THESIS ── */}
      <div className="pb-2">
        <div className="text-[14px] font-medium text-foreground whitespace-pre-line">
          {String(ai.thesis ?? "").trim() || "—"}
        </div>

        {String(ai.scoreRationale ?? "").trim() && (
          <div className="mt-1 text-[12px] text-foreground/80 whitespace-pre-line">
            {String(ai.scoreRationale).trim()}
          </div>
        )}

        {(isNum(ai.contentScore10) || isNum(ai.confidence)) && (
          <div className="mt-2 text-[10px] text-muted-foreground tabular-nums">
            {isNum(ai.contentScore10) ? `Содержание: ${ai.contentScore10.toFixed(1)}/10` : "Содержание: —"}
            {isNum(ai.confidence) ? ` · уверенность: ${(ai.confidence * 100).toFixed(0)}%` : ""}
          </div>
        )}
      </div>

      <div className="my-2 h-px w-full bg-border" />

      {/* ── KEY POINTS ── */}
      <div className="pb-2">
        <p className="text-sm font-semibold text-foreground">Ключевые пункты</p>

        <div className="mt-1 flex flex-col">
          {(Array.isArray(ai.keyPoints) ? ai.keyPoints : []).map((t, i, arr) => (
            <div
              key={i}
              className={["py-2", i < arr.length - 1 ? "border-b border-border" : ""].join(" ")}
            >
              <div className="text-[12px] text-foreground/80 whitespace-pre-line">
                {String(t ?? "").trim()}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="my-2 h-px w-full bg-border" />

      {/* ── SCORES ── */}
      <div className="pb-2">
        <p className="text-sm font-semibold text-foreground">Оценка содержания</p>

        <div className="mt-1 flex flex-col">
          {scoreRows.map((r, i) => (
            <div
              key={r.key}
              className={["py-2 flex items-center justify-between gap-3", i < scoreRows.length - 1 ? "border-b border-border" : ""].join(" ")}
            >
              <div className="text-[12px] text-foreground/80">{r.label}</div>
              <div className="text-[12px] text-foreground tabular-nums">
                {isNum(r.v) ? `${Math.round(r.v)}/10` : "—/10"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="my-2 h-px w-full bg-border" />

      {/* ── SUMMARY + LISTS ── */}
      <div className="pb-2">
        <p className="text-sm font-semibold text-foreground">Краткое резюме</p>
        <div className="mt-1 text-[12px] text-foreground/80 whitespace-pre-line">
          {String(ai.summary ?? "").trim() || "—"}
        </div>

        {strengths.length > 0 && (
          <div className="mt-3">
            <div className="text-[14px] font-medium text-foreground">Сильные стороны</div>
            <div className="mt-1 flex flex-col gap-1">
              {strengths.map((s, i) => (
                <div key={i} className="text-[12px] text-foreground/80 whitespace-pre-line">
                  {String(s ?? "").trim()}
                </div>
              ))}
            </div>
          </div>
        )}

        {improvements.length > 0 && (
          <div className="mt-3">
            <div className="text-[14px] font-medium text-foreground">Что улучшить</div>
            <div className="mt-1 flex flex-col gap-1">
              {improvements.map((s, i) => (
                <div key={i} className="text-[12px] text-foreground/80 whitespace-pre-line">
                  {String(s ?? "").trim()}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {(outline.length > 0 || evidence.length > 0) && <div className="my-2 h-px w-full bg-border" />}

      {/* ── OUTLINE ── */}
      {outline.length > 0 && (
        <div className="pb-2">
          <p className="text-sm font-semibold text-foreground">Структура выступления</p>

          <div className="mt-1 flex flex-col">
            {outline.map((o, i) => {
              const start = typeof o.startSec === "number" && Number.isFinite(o.startSec) ? o.startSec : null
              const end = typeof o.endSec === "number" && Number.isFinite(o.endSec) ? o.endSec : null
              return (
                <div
                  key={i}
                  className={["py-2", i < outline.length - 1 ? "border-b border-border" : ""].join(" ")}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-[14px] font-medium text-foreground">
                      {String(o.title ?? "").trim() || "—"}
                    </div>

                    {start != null && (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground tabular-nums"
                        onClick={() => opts.onSeek(start)}
                        title="Перейти к фрагменту"
                      >
                        {formatTime(start)}
                        {end != null ? `–${formatTime(end)}` : ""}
                      </button>
                    )}
                  </div>

                  {String(o.gist ?? "").trim() && (
                    <div className="mt-1 text-[12px] text-foreground/80 whitespace-pre-line">
                      {String(o.gist).trim()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {evidence.length > 0 && <div className="my-2 h-px w-full bg-border" />}

      {/* ── EVIDENCE ── */}
      {evidence.length > 0 && (
        <div className="pb-2">
          <p className="text-sm font-semibold text-foreground">Примеры и улучшения</p>

          <div className="mt-1 flex flex-col">
            {evidence.map((e, i) => {
              const start = typeof e.startSec === "number" && Number.isFinite(e.startSec) ? e.startSec : null
              const end = typeof e.endSec === "number" && Number.isFinite(e.endSec) ? e.endSec : null

              return (
                <div
                  key={i}
                  className={["py-2", i < evidence.length - 1 ? "border-b border-border" : ""].join(" ")}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-[14px] font-medium text-foreground">
                      {ruRelatesTo(e.relatesTo)}
                    </div>

                    {start != null && (
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground tabular-nums"
                        onClick={() => opts.onSeek(start)}
                        title="Перейти к фрагменту"
                      >
                        {formatTime(start)}
                        {end != null ? `–${formatTime(end)}` : ""}
                      </button>
                    )}
                  </div>

                  {String(e.quote ?? "").trim() && (
                    <div className="mt-1 text-[12px] text-foreground/80 whitespace-pre-line">
                      «{String(e.quote).trim()}»
                    </div>
                  )}

                  {String(e.whyItMatters ?? "").trim() && (
                    <div className="mt-2">
                      <div className="text-[10px] text-muted-foreground">Почему важно</div>
                      <div className="text-[12px] text-foreground/80 whitespace-pre-line">
                        {String(e.whyItMatters).trim()}
                      </div>
                    </div>
                  )}

                  {String(e.fix ?? "").trim() && (
                    <div className="mt-2">
                      <div className="text-[10px] text-muted-foreground">Как улучшить</div>
                      <div className="text-[12px] text-foreground/80 whitespace-pre-line">
                        {String(e.fix).trim()}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {exercises.length > 0 && <div className="my-2 h-px w-full bg-border" />}

      {/* ── EXERCISES ── */}
      {exercises.length > 0 && (
        <div className="pb-2">
          <p className="text-sm font-semibold text-foreground">Упражнения</p>
          <div className="mt-2 flex flex-col gap-1">
            {exercises.map((x, i) => (
              <div key={i} className="text-[12px] text-foreground/80 whitespace-pre-line">
                {String(x ?? "").trim()}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
