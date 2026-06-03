"use client"

import { useEffect, useMemo, useRef } from "react"
import { FileText } from "lucide-react"
import type { TokenGroup, WordToken } from "./transcriptTokens"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

export default function TranscriptPanel(opts: {
  title: string
  loading: boolean
  error: string | null

  groups: TokenGroup[]
  currentTimeSec: number
  onSeek: (t: number) => void

  fontSize: number
  onFontSizeChange: (n: number) => void
  showFontControls: boolean

  // NEW: request from parent to scroll transcript to time
  scrollTo?: { t: number; nonce: number } | null
}) {
  const fontDown = () => opts.onFontSizeChange(clamp(opts.fontSize - 1, 10, 24))
  const fontUp = () => opts.onFontSizeChange(clamp(opts.fontSize + 1, 10, 24))
  const fontReset = () => opts.onFontSizeChange(14)

  const tokensCount = useMemo(() => opts.groups.reduce((s, g) => s + g.tokens.length, 0), [opts.groups])

  const tokenToneClass = (tok: WordToken) => {
    const eps = 0.05
    const isFuture = opts.currentTimeSec < tok.startSec - eps
    const isPast = opts.currentTimeSec >= tok.endSec - eps
    const isCurrent = !isFuture && !isPast

    if (tok.kind === "pause") {
      if (isCurrent) return "text-foreground"
      if (isPast) return "text-foreground/80"
      return "text-muted-foreground/80"
    }

    const base = "!border-dashed"
    const tone = (cur: string, past: string, fut: string) => (isCurrent ? cur : isPast ? past : fut)

    if (tok.kind === "filler") {
      return [
        base,
        tone(
          "text-red-100 bg-red-500/15 !border-red-400/80",
          "text-red-100/80 bg-red-500/10 !border-red-400/60 hover:bg-red-500/15 hover:!border-red-400/80",
          "text-red-100/60 bg-red-500/5 !border-red-400/40 hover:bg-red-500/10 hover:!border-red-400/60"
        ),
      ].join(" ")
    }

    if (tok.kind === "repeat-word") {
      return [
        base,
        tone(
          "text-yellow-100 bg-amber-500/15 !border-yellow-400/80",
          "text-yellow-100/80 bg-amber-500/10 !border-yellow-400/60 hover:bg-amber-500/15 hover:!border-yellow-400/80",
          "text-yellow-100/60 bg-amber-500/5 !border-yellow-400/40 hover:bg-amber-500/10 hover:!border-yellow-400/60"
        ),
      ].join(" ")
    }

    if (tok.kind === "repeat-phrase") {
      return [
        base,
        tone(
          "text-orange-100 bg-orange-500/15 !border-orange-400/80",
          "text-orange-100/80 bg-orange-500/10 !border-orange-400/60 hover:bg-orange-500/15 hover:!border-orange-400/80",
          "text-orange-100/60 bg-orange-500/5 !border-orange-400/40 hover:bg-orange-500/10 hover:!border-orange-400/60"
        ),
      ].join(" ")
    }

    // emotion
    if (tok.kind === "emotion") {
      return [
        base,
        tone(
          "text-violet-100 bg-violet-500/15 !border-violet-400/80",
          "text-violet-100/80 bg-violet-500/10 !border-violet-400/60 hover:bg-violet-500/15 hover:!border-violet-400/80",
          "text-violet-100/60 bg-violet-500/5 !border-violet-400/40 hover:bg-violet-500/10 hover:!border-violet-400/60"
        ),
      ].join(" ")
    }

    // intensity
    if (tok.kind === "intensity") {
      const underline = "underline underline-offset-4"
      return [
        base,
        underline,
        tone(
          "text-foreground",
          "text-foreground/80",
          "text-muted-foreground/80"
        ),
      ].join(" ")
    }

    if (isCurrent) return "text-foreground bg-muted/40"
    if (isPast) return "text-foreground/80"
    return "text-muted-foreground/80"
  }

  const firstGroup = opts.groups?.[0] ?? null

  const tokenHint = (tok: WordToken) => {
    if (tok.kind === "filler") {
      return {
        title: "Слово‑паразит",
        body: "Старайтесь избегать слов‑паразитов\nили заменять их коротким молчанием.",
      }
    }
    if (tok.kind === "repeat-word") {
      return {
        title: "Повтор слова",
        body: "Попробуйте заменить слово синонимом\nили перестроить фразу.",
      }
    }
    if (tok.kind === "repeat-phrase") {
      return {
        title: "Повтор фразы",
        body: "Используйте повтор фраз с умом.",
      }
    }
    return null
  }

  // ── NEW: scrolling refs ───────────────────────────────────────────────
  const scrollBoxRef = useRef<HTMLDivElement | null>(null)
  const firstSepRef = useRef<HTMLDivElement | null>(null)
  const groupRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    const req = opts.scrollTo
    if (!req) return
    if (opts.loading || opts.error) return
    if (!opts.groups?.length) return

    const t = req.t
    // find group by time
    let idx = 0
    for (let i = 0; i < opts.groups.length; i++) {
      const g = opts.groups[i]
      if (t >= g.startSec && t < g.endSec) {
        idx = i
        break
      }
      if (t >= g.endSec) idx = i
    }

    // scroll to first separator for group 0 (so user sees 00:00–00:30 block)
    const target =
      idx === 0 ? firstSepRef.current : groupRefs.current[idx] ?? null

    if (!target) return

    // scroll within nearest scroll container
    target.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [opts.scrollTo?.nonce, opts.loading, opts.error, opts.groups])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border overflow-hidden">
      <div className="shrink-0 flex flex-col bg-background z-20">
        <div className="flex items-center gap-2 px-4 py-2">
          <FileText className="h-4 w-4 shrink-0 text-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground whitespace-nowrap">{opts.title}</div>
            <div className="text-[12px] text-muted-foreground/80">Кликните по слову, чтобы перемотать видео.</div>
          </div>
          <div className="flex-1" />
          {opts.showFontControls && (
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={fontDown} aria-label="Уменьшить">
                    –
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p className="text-xs">Уменьшить текст</p>
                </TooltipContent>
              </Tooltip>

              <Separator orientation="vertical" className="mx-1.5 h-4" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={fontReset} aria-label="Сбросить">
                    <span className="text-xs tabular-nums">{opts.fontSize}px</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p className="text-xs">Сбросить размер</p>
                </TooltipContent>
              </Tooltip>

              <Separator orientation="vertical" className="mx-1.5 h-4" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={fontUp} aria-label="Увеличить">
                    +
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p className="text-xs">Увеличить текст</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background to-transparent" />

        <div
          ref={scrollBoxRef}
          className="h-full overflow-y-auto px-4 pb-4 pt-2"
          style={{ fontSize: opts.fontSize }}
        >
          {opts.error ? (
            <p className="text-xs text-muted-foreground">Не удалось загрузить транскрипт: {opts.error}</p>
          ) : opts.loading ? (
            <p className="text-xs text-muted-foreground">Загружаем текст…</p>
          ) : tokensCount === 0 ? (
            <p className="text-xs text-muted-foreground">Нет данных</p>
          ) : (
            <div className="mx-auto w-full max-w-3xl whitespace-pre-wrap leading-loose">
              {/* first separator is inside scroll content, so it scrolls away */}
              {firstGroup && (
                <div ref={firstSepRef} className="flex items-center py-2">
                  <span className="text-xs text-muted-foreground/60 tabular-nums whitespace-nowrap mr-2">
                    {formatTime(firstGroup.startSec)} – {formatTime(firstGroup.endSec)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              {opts.groups.map((g, gi) => (
                <div
                  key={gi}
                  ref={(el) => {
                    groupRefs.current[gi] = el
                  }}
                >
                  {gi !== 0 && (
                    <div className="flex items-center py-2">
                      <span className="text-xs text-muted-foreground/60 tabular-nums whitespace-nowrap mr-2">
                        {formatTime(g.startSec)} – {formatTime(g.endSec)}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}

                  <div className="py-1">
                    {g.tokens.map((tok) => {
                      const hint = tokenHint(tok)

                      const btn = (
                        <button
                          type="button"
                          onClick={() => opts.onSeek(tok.startSec)}
                          className={[
                            "inline-flex items-center align-baseline leading-none mx-[1px] rounded px-1 py-1 border border-transparent cursor-pointer select-none transition-colors focus:outline-none hover:bg-muted/80",
                            tokenToneClass(tok),
                          ].join(" ")}
                        >
                          {tok.kind === "pause" ? (
                            <span aria-hidden className="relative inline-block w-4 h-[0.8em] align-baseline">
                              <span className="absolute inset-x-0 bottom-0 border-b border-dashed border-current" />
                              <span className="absolute left-0 bottom-0 h-[55%] border-l border-dashed border-current" />
                              <span className="absolute right-0 bottom-0 h-[55%] border-r border-dashed border-current" />
                            </span>
                          ) : (
                            tok.text
                          )}
                        </button>
                      )

                      return (
                        <span key={tok.id}>
                          {hint ? (
                            <Tooltip delayDuration={180}>
                              <TooltipTrigger asChild>{btn}</TooltipTrigger>
                              <TooltipContent
                                hideArrow
                                side="top"
                                align="center"
                                sideOffset={5}
                                className={[
                                  "max-w-xs",
                                  "rounded-lg",
                                  "border border-border",
                                  "bg-muted",
                                  "text-foreground",
                                  "px-2 py-2",
                                  "whitespace-pre-wrap",
                                ].join(" ")}
                              >
                                <div className="space-y-1">
                                  <div className="text-xs font-semibold">{hint.title}</div>
                                  <div className="text-xs text-muted-foreground leading-relaxed">{hint.body}</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            btn
                          )}
                          {tok.suffix}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
