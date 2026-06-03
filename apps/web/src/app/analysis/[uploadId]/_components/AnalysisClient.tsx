"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Separator } from "@/components/ui/separator"

import VideoPanel from "./VideoPanel"
import GraphsPanel from "./GraphsPanel"
import TranscriptPanel from "./TranscriptPanel"
import ScorePanel from "./ScorePanel"
import ChatbotPanel from "./ChatbotPanel"
import AdvicePanel from "./AdvicePanel"
import AiInsightsPanel from "./AiInsightsPanel"
import InDevelopment from "./InDevelopment"
import { buildTokens, groupTokensByBuckets, type TokenGroup } from "./transcriptTokens"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "").trim()

type TranscriptWord = { word: string; start: number | null; end: number | null; probability?: number | null }
type TranscriptSegment = { start: number; end: number; text: string; words?: TranscriptWord[] }
type TranscriptJson = { segments: TranscriptSegment[]; text?: string; language?: string | null; duration?: number | null }

type AnalysisJson = {
  uploadId: string
  metrics?: {
    durationSec?: number
    timeseries?: {
      rateWpm?: { stepSec: number; windowSec: number; values: Array<[number, number]> }
      loudnessDb?: { stepSec: number; windowSec: number; values: Array<[number, number]> }
    }
  }
  fillers?: { occurrences?: Array<{ phrase: string; start: number; end: number }> }
  repetitions?: { occurrences?: Array<{ phrase: string; start: number; end: number }> }
  wordRepetitions?: { occurrences?: Array<{ word: string; start: number; end: number }> }
  pauses?: { occurrences?: Array<{ start: number; end: number; duration: number }> }
  ai?: any
}

type TranscriptApiResponse = { uploadId: string; transcript?: TranscriptJson }
type AnalysisApiResponse = { uploadId: string; analysis?: AnalysisJson }

type UploadSettings = {
  whisperModel?: string
  analysisModel?: string
  diarization?: boolean
  gazeAnalysis?: boolean
  criteria?: {
    speechDurationMinutes?: number | null
    hasCriteriaFile?: boolean
    criteriaFileName?: string | null
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function modelToHeaderLabel(raw: string) {
  const s = (raw ?? "").trim().toLowerCase()
  if (!s) return "chatGPT-5.4-mini"
  if (s.startsWith("chatgpt-")) return "chatGPT-" + s.slice("chatgpt-".length)
  if (s.startsWith("gpt-")) return "chatGPT-" + s.slice("gpt-".length)
  return raw
}

function readUploadSettings(uploadId: string): UploadSettings | null {
  try {
    const raw = localStorage.getItem(`upload-settings-${uploadId}`)
    if (!raw) return null
    const j = JSON.parse(raw) as any
    if (!j || typeof j !== "object") return null
    return j as UploadSettings
  } catch {
    return null
  }
}

function PanelTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T
  onChange: (v: T) => void
  tabs: Array<{ value: T; label: string }>
}) {
  return (
    <div className="flex items-center">
      {tabs.map((tab, i) => (
        <span key={tab.value} className="flex items-center">
          {i > 0 && <Separator orientation="vertical" className="mx-3 h-5" />}
          <button
            type="button"
            onClick={() => onChange(tab.value)}
            className={[
              "text-base font-semibold transition-colors select-none whitespace-nowrap leading-none py-0.5",
              value === tab.value ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        </span>
      ))}
    </div>
  )
}

export default function AnalysisClient({ uploadId }: { uploadId: string }) {
  const videoSrc = `${API_BASE_URL}/uploads/${uploadId}/video`

  const [filename, setFilename] = useState("")
  useEffect(() => {
    try {
      setFilename(localStorage.getItem(`upload-filename-${uploadId}`) ?? "")
    } catch {}
  }, [uploadId])

  // Settings → model for chat
  const [settings, setSettings] = useState<UploadSettings | null>(null)
  useEffect(() => setSettings(readUploadSettings(uploadId)), [uploadId])

  const chatModel = useMemo(() => {
    let override = ""
    try {
      override = (localStorage.getItem(`upload-chat-model-${uploadId}`) ?? "").trim()
    } catch {}
    const fromSettings = (settings?.analysisModel ?? "").trim()
    return override || fromSettings || "gpt-5.4-mini"
  }, [settings?.analysisModel, uploadId])

  const chatModelLabel = useMemo(() => modelToHeaderLabel(chatModel), [chatModel])

  // Load analysis+transcript
  const [analysis, setAnalysis] = useState<AnalysisJson | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const [transcript, setTranscript] = useState<TranscriptJson | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setAnalysis(null)
    setAnalysisError(null)

    fetch(`${API_BASE_URL}/uploads/${uploadId}/analysis`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as AnalysisApiResponse
      })
      .then((data) => {
        if (!cancelled) setAnalysis(data?.analysis ?? null)
      })
      .catch((e) => {
        if (!cancelled) setAnalysisError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [uploadId])

  useEffect(() => {
    let cancelled = false
    setTranscript(null)
    setTranscriptError(null)

    fetch(`${API_BASE_URL}/uploads/${uploadId}/transcript`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as TranscriptApiResponse
      })
      .then((data) => {
        if (!cancelled) setTranscript(data?.transcript ?? null)
      })
      .catch((e) => {
        if (!cancelled) setTranscriptError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [uploadId])

  const durationSec =
    (typeof transcript?.duration === "number" && Number.isFinite(transcript.duration) ? transcript.duration : null) ??
    (typeof analysis?.metrics?.durationSec === "number" && Number.isFinite(analysis.metrics.durationSec)
      ? analysis.metrics.durationSec
      : null) ??
    0

  // Video ref + current time tracking
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)

  const [playbackRate, setPlaybackRate] = useState(1.0)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    let raf = 0
    let mounted = true
    const loop = () => {
      if (!mounted) return
      const t = videoRef.current?.currentTime ?? 0
      setCurrentTimeSec((prev) => (Math.abs(prev - t) > 0.03 ? t : prev))
      raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => {
      mounted = false
      window.cancelAnimationFrame(raf)
    }
  }, [])

  const [scrollReq, setScrollReq] = useState<{ t: number; nonce: number } | null>(null)
  
  const seekTo = (t: number) => {
    const v = videoRef.current
    if (!v) return
  
    const dur = typeof v.duration === "number" && Number.isFinite(v.duration) ? v.duration : durationSec
    const tt = clamp(t, 0, Math.max(0, dur || 0))
  
    v.currentTime = tt
    v.play().catch(() => {})
  
    setScrollReq({ t: tt, nonce: Date.now() })
  }

  const tokens = useMemo(() => {
    if (!transcript || !analysis) return []
    return buildTokens(transcript, analysis)
  }, [transcript, analysis])

  const groups = useMemo<TokenGroup[]>(() => {
    const dur = durationSec || (tokens.length ? Math.max(0, tokens[tokens.length - 1].endSec) : 0) || 0
    return groupTokensByBuckets(tokens, dur, 30)
  }, [tokens, durationSec])

  const loading = !analysis || !transcript
  const [fontSize, setFontSize] = useState(14)

  // central tabs like before
  const [centerTab, setCenterTab] = useState<"score" | "chat">("score")
  const [rightTab, setRightTab] = useState<"advice" | "ai">("advice")

  return (
    <section className="h-[calc(100vh-3.5rem)] w-full overflow-hidden px-4 py-4">
      <div
        className="
          grid h-full min-h-0 w-full min-w-0 gap-4
          grid-cols-1
          lg:grid-cols-[minmax(340px,1.1fr)_minmax(560px,2fr)_minmax(340px,1.1fr)]
        "
      >
        {/* LEFT column: one outer frame + two inner framed panels (1:2) */}
        <div className="min-h-0 min-w-0">
          <div className="flex h-full min-h-0 flex-col rounded-xl border border-border overflow-hidden">
            <div className="min-h-0 flex-1 p-4">
              <div className="grid h-full min-h-0 grid-rows-[1fr_2fr] gap-4">
                {/* Top (video) — has its own frame */}
                <div className="min-h-0">
                  <VideoPanel
                    title="Видео"
                    subtitle={filename || uploadId}
                    videoSrc={videoSrc}
                    videoRef={videoRef}
                    error={analysisError}
                    playbackRate={playbackRate}
                    onPlaybackRateChange={setPlaybackRate}
                  />
                </div>

                {/* Bottom — its own frame */}
                <div className="flex h-full min-h-0 flex-col rounded-xl border border-border overflow-hidden">
                  <GraphsPanel
                    analysis={analysis}
                    analysisError={analysisError}
                    durationSec={durationSec}
                    currentTimeSec={currentTimeSec}
                    onSeek={seekTo}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER column: like before */}
        <div className="min-h-0 min-w-0">
          <div className="flex h-full min-h-0 flex-col rounded-xl border border-border overflow-hidden">
            <div className="shrink-0 border-b border-border px-5 py-3.5">
              <PanelTabs
                value={centerTab}
                onChange={setCenterTab}
                tabs={[
                  { value: "score", label: "Общая оценка" },
                  { value: "chat", label: "Чат-бот" },
                ]}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {centerTab === "chat" ? (
                <div className="h-full p-4">
                  <ChatbotPanel uploadId={uploadId} model={chatModel} modelLabel={chatModelLabel} />
                </div>
              ) : (
                <div className="h-full min-h-0 p-4">
                  <div className="grid h-full min-h-0 grid-rows-[1fr_2fr] gap-4">
                    <div className="min-h-0">
                      <ScorePanel analysis={analysis} analysisError={analysisError} onSeek={seekTo} />
                    </div>

                    <div className="min-h-0">
                      <TranscriptPanel
                        title="Транскрипт"
                        loading={loading}
                        error={transcriptError}
                        groups={groups}
                        currentTimeSec={currentTimeSec}
                        onSeek={seekTo}
                        scrollTo={scrollReq}
                        fontSize={fontSize}
                        onFontSizeChange={setFontSize}
                        showFontControls
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT column: Advice | AI breakdown */}
        <div className="min-h-0 min-w-0">
          <div className="flex h-full min-h-0 flex-col rounded-xl border border-border overflow-hidden">
            <div className="shrink-0 border-b border-border px-5 py-3.5">
              <PanelTabs
                value={rightTab}
                onChange={setRightTab}
                tabs={[
                  { value: "advice", label: "Советы" },
                  { value: "ai", label: "Разбор от ИИ" },
                ]}
              />
            </div>
        
            <div className="min-h-0 flex-1 overflow-hidden">
              {rightTab === "advice" ? (
                <AdvicePanel analysis={analysis} analysisError={analysisError} onSeek={seekTo} />
              ) : (
                <AiInsightsPanel analysis={analysis} analysisError={analysisError} onSeek={seekTo} />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
