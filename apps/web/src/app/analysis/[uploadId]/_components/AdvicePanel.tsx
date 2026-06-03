"use client"

type CoachPlan = {
  planTitle?: string
  planItems?: Array<{ title?: string; body?: string; focusKey?: "fillers" | "repetitions" | "pauses" | "rate" | null }>
  howToTitle?: string
  howToBlocks?: Array<{ minutes?: number; title?: string; body?: string }>
  cheatSheetTitle?: string | null
  cheatSheetBody?: string | null
}

type AnalysisJson = {
  ai?: { coachPlan?: CoachPlan }
}

export default function AdvicePanel(opts: {
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

  const coach = opts.analysis?.ai?.coachPlan ?? null

  if (!coach) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Советы пока не готовы (ИИ-генерация не выполнена).
      </div>
    )
  }

  const planTitle = (coach.planTitle ?? "План тренировки (10 минут)").trim()
  const planItems = Array.isArray(coach.planItems) ? coach.planItems : []

  const howToTitle = (coach.howToTitle ?? "Как выполнять").trim()
  const howToBlocks = Array.isArray(coach.howToBlocks) ? coach.howToBlocks : []

  const cheatTitle = coach.cheatSheetTitle ?? null
  const cheatBody = coach.cheatSheetBody ?? null

  return (
    <div className="h-full min-h-0 p-4 flex flex-col">
      {/* ── PLAN ── */}
      <div className="shrink-0">
        <p className="text-sm font-semibold text-foreground">{planTitle}</p>

        <div className="mt-1 flex flex-col">
          {planItems.map((x, i) => (
            <div
              key={i}
              className={[
                "py-2",
                i < planItems.length - 1 ? "border-b border-border" : "",
              ].join(" ")}
            >
              <div className="text-[14px] font-medium text-foreground">{String(x.title ?? "").trim()}</div>

              <div className="mt-1 text-[12px] text-foreground/80 whitespace-pre-line">
                {String(x.body ?? "").trim()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* separator between plan and the rest */}
      <div className="my-2 h-px w-full bg-border" />

      {/* ── HOW TO ── */}
      <div className="min-h-0 flex-1 flex flex-col">
        <p className="text-sm font-semibold text-foreground">{howToTitle}</p>

        <div className="mt-2 flex flex-col gap-4">
          {howToBlocks.map((b, i) => (
            <div key={i}>
              <div className="text-[14px] font-medium text-foreground">
                {String(b.title ?? "").trim() || `${Number(b.minutes ?? 0) || ""}`.trim()}
              </div>
              <div className="mt-1 text-[12px] text-foreground/80 whitespace-pre-line">
                {String(b.body ?? "").trim()}
              </div>
            </div>
          ))}
        </div>

        {(cheatTitle || cheatBody) && (
          <div className="mt-2 text-[12px] text-foreground/80 whitespace-pre-line">
            {cheatTitle && (
              <div className="text-[14px] font-medium text-foreground">
                {String(cheatTitle).trim()}
              </div>
            )}
            {cheatBody ? <div className="mt-1 whitespace-pre-line">{String(cheatBody).trim()}</div> : null}
          </div>
        )}
      </div>
    </div>
  )
}
