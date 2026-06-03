"use client"

import type { RefObject } from "react"
import { Gauge, FileVideo } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export default function VideoPanel(opts: {
  title: string
  subtitle: string
  videoSrc: string
  videoRef: RefObject<HTMLVideoElement | null>
  error: string | null

  playbackRate: number
  onPlaybackRateChange: (r: number) => void

  // NEW
  embedded?: boolean
}) {
  const speedDown = () =>
    opts.onPlaybackRateChange(clamp(Number((opts.playbackRate - 0.25).toFixed(2)), 0.5, 2))
  const speedUp = () =>
    opts.onPlaybackRateChange(clamp(Number((opts.playbackRate + 0.25).toFixed(2)), 0.5, 2))
  const speedReset = () => opts.onPlaybackRateChange(1)

  return (
    <div
      className={
        opts.embedded
          ? "flex h-full min-h-0 flex-col overflow-hidden"
          : "flex h-full min-h-0 flex-col rounded-xl border border-border overflow-hidden"
      }
    >
      <div className="shrink-0 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileVideo className="h-4 w-4 shrink-0 text-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground leading-none">{opts.title}</div>
            <div className="text-[12px] text-muted-foreground/80 truncate" title={opts.subtitle}>
              {opts.subtitle}
            </div>
          </div>
        </div>
      </div>

      {opts.error ? (
        <div className="shrink-0 border-b border-border px-4 py-3 text-xs text-muted-foreground">
          Ошибка загрузки данных: {opts.error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-black/5">
        <video ref={opts.videoRef as any} src={opts.videoSrc} controls className="h-full w-full object-contain" />
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <div className="flex items-center justify-center gap-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={speedDown}
                aria-label="Замедлить"
              >
                –
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p className="text-xs">Замедлить</p>
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-2 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-2"
                onClick={speedReset}
                aria-label="Сбросить скорость"
              >
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-medium tabular-nums">{opts.playbackRate.toFixed(2)}x</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p className="text-xs">Сбросить скорость</p>
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-2 h-4" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={speedUp}
                aria-label="Ускорить"
              >
                +
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p className="text-xs">Ускорить</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
