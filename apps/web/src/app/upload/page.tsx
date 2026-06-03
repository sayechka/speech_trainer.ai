"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import {
  Check,
  ChevronDown,
  CircleHelp,
  FileVideo,
  Minus,
  Pause,
  Play,
  Plus,
  Replace,
  RotateCcw,
  Settings,
  Trash,
  Upload,
  Video,
  X,
} from "lucide-react"
import * as SelectPrimitive from "@radix-ui/react-select"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader"
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const MAX_FILE_SIZE_MB = 500
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

const BASE_LOADING_STATES = [
  { text: "Извлечение аудио" },
  { text: "Транскрибация (Whisper)" },
  { text: "Анализ транскрибации\n(слова-паразиты, повторы, паузы и пр.)" },
  { text: "Подготовка результата" },
] as const

const LOADER_STEP_DURATION_MS = 1800

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000")
  .replace(/\/$/, "")
  .trim()

const WHISPER_MODELS = [
  { value: "tiny", label: "tiny", description: "Самая быстрая скорость, низкое качество." },
  { value: "base", label: "base", description: "Немного медленнее, немного качественнее." },
  { value: "small", label: "small", description: "Баланс скорости и качества." },
  { value: "medium", label: "medium", description: "Медленнее, но качественнее предыдущих." },
  { value: "large-v3", label: "large-v3", description: "Самая качественная, медленная скорость." },
] as const
type WhisperModel = (typeof WHISPER_MODELS)[number]["value"]

const CHATGPT_ANALYSIS_MODELS = [
  { value: "gpt-5.4", label: "gpt-5.4" },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { value: "gpt-5.4-nano", label: "gpt-5.4-nano" },
] as const
type ChatGPTAnalysisModel = (typeof CHATGPT_ANALYSIS_MODELS)[number]["value"]

type Mode = "upload" | "record"
type PermissionState = "idle" | "requesting" | "granted" | "denied"
type StopBehavior = "save" | "discard" | "restart"

type AnalysisSettings = {
  whisperModel: WhisperModel
  analysisModel: ChatGPTAnalysisModel
  diarization: boolean
  gazeAnalysis: boolean
  criteria: {
    speechDurationMinutes: number | null
  }
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { delayChildren: 0.08, staggerChildren: 0.12 } },
}
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
}

function pickBestMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
  for (const mt of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) return mt
  }
  return ""
}

function isAcceptedVideo(file: File) {
  const t = (file.type ?? "").toLowerCase().trim()
  if (t === "video/mp4") return true
  if (t.startsWith("video/webm")) return true

  const name = (file.name ?? "").toLowerCase()
  if (name.endsWith(".mp4")) return true
  if (name.endsWith(".webm")) return true
  return false
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function formatMMSS(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

function WhisperModelSelectItem({
  value,
  label,
  description,
}: {
  value: WhisperModel
  label: string
  description: string
}) {
  return (
    <SelectPrimitive.Item
      value={value}
      textValue={label}
      className={[
        "relative w-full cursor-default select-none rounded-sm",
        "py-2 pl-2 pr-8 outline-none",
        "focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-60",
        "text-xs sm:text-sm",
      ].join(" ")}
    >
      <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>
        <span className="font-medium">{label}</span>
      </SelectPrimitive.ItemText>

      <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">{description}</div>
    </SelectPrimitive.Item>
  )
}

export default function UploadPage() {
  const router = useRouter()

  // upload refs
  const inputRef = useRef<HTMLInputElement>(null)
  const criteriaInputRef = useRef<HTMLInputElement>(null)

  // file + preview
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // UI state
  const [mode, setMode] = useState<Mode>("upload")
  const [dragging, setDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [criteriaOpen, setCriteriaOpen] = useState(true)

  // errors + loader
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaderValue, setLoaderValue] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)

  // criteria
  const [criteriaFile, setCriteriaFile] = useState<File | null>(null)
  const [speechDurationMinutesInput, setSpeechDurationMinutesInput] = useState<string>("")

  const speechDurationMinutes = useMemo(() => {
    const v = speechDurationMinutesInput.trim()
    if (!v) return null
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return clampInt(n, 0, 24 * 60)
  }, [speechDurationMinutesInput])

  // settings (all unlocked)
  const [settings, setSettings] = useState<AnalysisSettings>({
    whisperModel: "small",
    analysisModel: "gpt-5.4-mini",
    diarization: false,
    gazeAnalysis: false,
    criteria: { speechDurationMinutes: null },
  })

  const loadingStates = useMemo(() => {
    const states = [...BASE_LOADING_STATES]
    if (settings.gazeAnalysis) {
      // вставляем перед "Подготовка результата"
      states.splice(states.length - 1, 0, { text: "Анализ видео\n(направление взгляда)" })
    }
    return states
  }, [settings.gazeAnalysis])

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      criteria: { ...prev.criteria, speechDurationMinutes },
    }))
  }, [speechDurationMinutes])

  // ─────────────────────────────────────────────────────────────────────────────
  // Preview URL
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // ─────────────────────────────────────────────────────────────────────────────
  // Recording (camera) logic
  // ─────────────────────────────────────────────────────────────────────────────
  const supportsRecording = useMemo(
    () => Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"),
    []
  )
  const recordMimeType = useMemo(() => pickBestMimeType(), [])

  const liveVideoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<number | null>(null)

  const stopBehaviorRef = useRef<StopBehavior>("save")

  const [permission, setPermission] = useState<PermissionState>("idle")

  // `recording` = есть подготовленная сессия записи (recorder создан), но она может быть еще не стартована
  const [recording, setRecording] = useState(false)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(true)

  const [recordSecs, setRecordSecs] = useState(0)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current) return
    timerRef.current = window.setInterval(() => {
      setRecordSecs((s) => s + 1)
    }, 1000)
  }, [])

  const stopStream = useCallback(() => {
    const s = streamRef.current
    if (s) for (const tr of s.getTracks()) tr.stop()
    streamRef.current = null
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null
  }, [])

  const resetRecorderState = useCallback(() => {
    stopTimer()
    recorderRef.current = null
    chunksRef.current = []
    setRecording(false)
    setStarted(false)
    setPaused(true)
    setRecordSecs(0)
  }, [stopTimer])

  const cleanupRecordingAll = useCallback(() => {
    try {
      // stop() может бросать, если recorder еще не start'нут
      recorderRef.current?.stop()
    } catch {}
    resetRecorderState()
    stopStream()
    setPermission("idle")
  }, [resetRecorderState, stopStream])

  useEffect(() => {
    return () => {
      cleanupRecordingAll()
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [cleanupRecordingAll])

  const ensureStream = useCallback(async () => {
    if (streamRef.current) return streamRef.current

    setPermission("requesting")
    const constraints: MediaStreamConstraints = {
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      setPermission("granted")

      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream
        liveVideoRef.current.muted = true
        await liveVideoRef.current.play().catch(() => {})
      }

      return stream
    } catch (e) {
      setPermission("denied")
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось получить доступ к камере/микрофону. Проверьте разрешения браузера."
      )
      throw e
    }
  }, [])

  // Подготовить recorder, но НЕ начинать запись (начнется только по нажатию кнопки)
  const prepareRecorder = useCallback(
    (stream: MediaStream) => {
      const mr = new MediaRecorder(stream, recordMimeType ? { mimeType: recordMimeType } : undefined)
      recorderRef.current = mr
      chunksRef.current = []

      setRecording(true)
      setStarted(false)
      setPaused(true)
      setRecordSecs(0)

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onpause = () => {
        setPaused(true)
        stopTimer()
        // важно: превью ВИДЕО не останавливаем (по ТЗ оно должно продолжаться)
      }

      mr.onresume = () => {
        setPaused(false)
        startTimer()
        // превью также продолжается
      }

      mr.onstop = () => {
        const behavior = stopBehaviorRef.current
        stopBehaviorRef.current = "save"

        const blob = new Blob(chunksRef.current, { type: "video/webm" })
        chunksRef.current = []

        if (behavior === "restart") {
          // оставить stream, подготовить новую запись и остаться в режиме записи (на паузе)
          resetRecorderState()
          setMode("record")
          setPermission("granted")

          void (async () => {
            try {
              const s = await ensureStream()
              setError(null)
              prepareRecorder(s)
            } catch {}
          })()
          return
        }

        // при save/discard stream можно закрыть
        stopStream()
        resetRecorderState()
        setMode("upload")
        setPermission("idle")

        if (behavior === "discard") return

        // save
        const f = new File([blob], `recording-${Date.now()}.webm`, {
          type: "video/webm",
          lastModified: Date.now(),
        })

        if (!isAcceptedVideo(f)) {
          setError("Форматы: .mp4 и .webm")
          setFile(null)
          return
        }
        if (f.size > MAX_FILE_SIZE) {
          setError(`Размер: до ${MAX_FILE_SIZE_MB}MB`)
          setFile(null)
          return
        }

        setError(null)
        setFile(f)
      }
    },
    [ensureStream, recordMimeType, resetRecorderState, startTimer, stopStream, stopTimer]
  )

  const enterRecordMode = useCallback(async () => {
    if (loading) return
    if (!supportsRecording) {
      setError("Запись недоступна в этом браузере (MediaRecorder)")
      return
    }

    // record mode always starts from scratch
    setError(null)
    setDragging(false)
    setFile(null)
    if (inputRef.current) inputRef.current.value = ""
    setMode("record")

    try {
      const s = await ensureStream()
      // ВАЖНО: не начинаем запись автоматически — готовим и оставляем на паузе
      prepareRecorder(s)
    } catch {
      // error already set
    }
  }, [ensureStream, loading, prepareRecorder, supportsRecording])

  const togglePause = useCallback(() => {
    const mr = recorderRef.current
    if (!mr || !recording) return

    // Если запись еще не стартовала — стартуем только по этому нажатию
    if (!started) {
      try {
        setStarted(true)
        setPaused(false)
        setRecordSecs(0)
        startTimer()
        mr.start(1000)
      } catch {
        // если не получилось стартовать — вернемся в "паузу"
        setStarted(false)
        setPaused(true)
        stopTimer()
      }
      return
    }

    if (mr.state === "recording") {
      try {
        mr.pause()
      } catch {}
      return
    }

    if (mr.state === "paused") {
      try {
        mr.resume()
      } catch {}
    }
  }, [recording, startTimer, started, stopTimer])

  const exitRecordMode = useCallback(() => {
    stopBehaviorRef.current = "discard"
    try {
      // если не стартовали — stop бросит, поэтому try/catch
      recorderRef.current?.stop()
    } catch {}
    cleanupRecordingAll()
    setMode("upload")
  }, [cleanupRecordingAll])

  const restartRecording = useCallback(() => {
    if (!supportsRecording) return
    if (loading) return

    setError(null)

    // если еще нет stream (разрешение не дали) — просто повторим вход
    if (!streamRef.current) {
      void enterRecordMode()
      return
    }

    const mr = recorderRef.current

    // Если запись уже шла (или была на паузе после старта) — останавливаем и после onstop подготовим заново (на паузе)
    if (mr && mr.state !== "inactive") {
      stopBehaviorRef.current = "restart"
      try {
        mr.stop()
      } catch {}
      return
    }

    // Если recorder не стартовали (inactive) — просто подготовить новый recorder (без автозапуска)
    void (async () => {
      try {
        const s = await ensureStream()
        setMode("record")
        prepareRecorder(s)
      } catch {}
    })()
  }, [ensureStream, enterRecordMode, loading, prepareRecorder, supportsRecording])

  const isActivelyRecording = started && !paused

  // ─────────────────────────────────────────────────────────────────────────────
  // Upload handling
  // ─────────────────────────────────────────────────────────────────────────────
  const validateFile = useCallback((f: File) => {
    if (!isAcceptedVideo(f)) return "Форматы: .mp4 и .webm"
    if (f.size > MAX_FILE_SIZE) return `Размер: до ${MAX_FILE_SIZE_MB}MB`
    return null
  }, [])

  const handleFile = useCallback(
    (f: File) => {
      const validationError = validateFile(f)
      if (validationError) {
        setError(validationError)
        setFile(null)
        return
      }
      setError(null)
      setMode("upload")
      setFile(f)
    },
    [validateFile]
  )

  const clearFile = useCallback(() => {
    setFile(null)
    setError(null)
    setDragging(false)
    if (inputRef.current) inputRef.current.value = ""
  }, [])

  const replaceFile = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(false)
      const dropped = e.dataTransfer.files?.[0]
      if (dropped) handleFile(dropped)
    },
    [handleFile]
  )

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) handleFile(selected)
    e.target.value = ""
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Processing (upload -> job -> SSE -> redirect)
  // ─────────────────────────────────────────────────────────────────────────────
  const stopProcessing = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setLoading(false)
    setLoaderValue(0)
  }, [])

  const processFile = useCallback(
    async (f: File) => {
      setLoaderValue(0)
      setLoading(true)
      setError(null)

      try {
        const form = new FormData()
        form.append("file", f)

        const uploadRes = await fetch(`${API_BASE_URL}/uploads`, { method: "POST", body: form })
        if (!uploadRes.ok) throw new Error(`Upload error: ${uploadRes.status}`)

        const uploadData = (await uploadRes.json()) as { uploadId: string; filename?: string }
        const uploadId = uploadData.uploadId
        const uploadedFilename = (uploadData.filename ?? f.name).trim()

        if (criteriaFile) {
          const cForm = new FormData()
          cForm.append("file", criteriaFile)
          const cRes = await fetch(`${API_BASE_URL}/uploads/${uploadId}/criteria`, {
            method: "POST",
            body: cForm,
          })
          if (!cRes.ok) throw new Error(`Criteria upload error: ${cRes.status}`)
        }

        const analysisPayload = {
          uploadId,
          filename: uploadedFilename,
          settings: {
            ...settings,
            criteria: {
              ...settings.criteria,
              speechDurationMinutes,
              hasCriteriaFile: Boolean(criteriaFile),
              criteriaFileName: criteriaFile?.name ?? null,
            },
          },
          ui: {
            steps: loadingStates.map((s) => s.text),
            stepDurationMs: LOADER_STEP_DURATION_MS,
          },
        }

        const res = await fetch(`${API_BASE_URL}/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(analysisPayload),
        })
        if (!res.ok) throw new Error(`API error: ${res.status}`)

        const data = (await res.json()) as { id: string }
        const id = data.id

        const doRedirect = () => {
          try {
            localStorage.setItem(`upload-filename-${uploadId}`, uploadedFilename)
            localStorage.setItem(`upload-settings-${uploadId}`, JSON.stringify(analysisPayload.settings))
          } catch {}
          router.push(`/analysis/${uploadId}`)
        }

        const es = new EventSource(`${API_BASE_URL}/jobs/${id}/events`)
        eventSourceRef.current = es

        const safeJson = (raw: string) => {
          try {
            return JSON.parse(raw) as unknown
          } catch {
            return null
          }
        }

        es.addEventListener("snapshot", (evt) => {
          const payload = safeJson((evt as MessageEvent).data) as { status?: string; step?: number } | null
          if (payload && typeof payload.step === "number") setLoaderValue(payload.step)
          if (payload?.status === "done") {
            setLoading(false)
            es.close()
            if (eventSourceRef.current === es) eventSourceRef.current = null
            doRedirect()
          }
        })

        es.addEventListener("progress", (evt) => {
          const payload = safeJson((evt as MessageEvent).data) as { step?: number } | null
          if (payload && typeof payload.step === "number") setLoaderValue(payload.step)
        })

        es.addEventListener("done", () => {
          setLoading(false)
          es.close()
          if (eventSourceRef.current === es) eventSourceRef.current = null
          doRedirect()
        })

        es.addEventListener("error", () => {
          setLoading(false)
          es.close()
          if (eventSourceRef.current === es) eventSourceRef.current = null
          setError("Ошибка соединения при обработке. Попробуйте ещё раз.")
        })
      } catch (e) {
        setLoading(false)
        setLoaderValue(0)
        setError(e instanceof Error ? e.message : "Не удалось запустить анализ.")
      }
    },
    [criteriaFile, loadingStates, router, settings, speechDurationMinutes]
  )

  const handleStartAnalysis = useCallback(() => {
    if (loading) return

    if (file) {
      void processFile(file)
      return
    }

    // В режиме записи: "Далее" сначала останавливает запись и создает файл для предпросмотра.
    // ВАЖНО: если запись еще НЕ стартовали (started=false), кнопка disabled, сюда не попадем.
    if (mode === "record" && started) {
      stopBehaviorRef.current = "save"
      try {
        recorderRef.current?.stop()
      } catch {}
    }
  }, [file, loading, mode, processFile, started])

  // Чтобы "Далее" не было активно до начала записи:
  const canStartAnalysis = Boolean(file) || (mode === "record" && started)

  const dropzoneClasses = useMemo(() => {
    return [
      "group flex h-full cursor-pointer flex-col items-center justify-center",
      "rounded-xl border-[2.5px] border-dashed",
      "transform-gpu will-change-transform",
      "transition-all duration-200 ease-out",
      "sm:hover:scale-[1.01] active:scale-[0.99]",
      error
        ? "border-destructive/20 bg-destructive/5 hover:border-destructive/40"
        : dragging
          ? "border-primary bg-primary/20 sm:scale-[1.01]"
          : "border-border hover:border-muted-foreground/40",
    ].join(" ")
  }, [dragging, error])

  const stageAspectRatio = "16/9"
  const title = mode === "record" ? "Запишите видео" : "Загрузите видео"

  const recordButtonTooltip =
    !started ? "Начать запись" : paused ? "Продолжить" : "Пауза"

  return (
    <section className="relative flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 sm:px-8">
      <Loader
        loadingStates={[...loadingStates]}
        loading={loading}
        duration={LOADER_STEP_DURATION_MS}
        loop={false}
        value={loaderValue}
      />

      {loading && (
        <button
          className="fixed right-4 top-4 z-[120] text-foreground"
          onClick={stopProcessing}
          aria-label="Закрыть"
          type="button"
        >
          <X className="h-8 w-8" />
        </button>
      )}

      <div className="mx-auto w-full max-w-3xl pt-16 sm:pt-24 text-center">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.h1 variants={item} className="text-4xl font-bold tracking-tight sm:text-6xl">
            {title}
          </motion.h1>

          <motion.div variants={item} className="mt-8 flex justify-center">
            <div className="w-full max-w-lg">
              {/* Stage */}
              <div
                className="w-full"
                style={{ aspectRatio: stageAspectRatio }}
                onDragOver={(e) => {
                  if (mode !== "upload") return
                  if (!file) {
                    e.preventDefault()
                    setDragging(true)
                  }
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={mode === "upload" && !file ? onDrop : undefined}
              >
                {file ? (
                  <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border">
                    {previewUrl && (
                      <div className="min-h-0 flex-1">
                        <video src={previewUrl} controls className="h-full w-full object-contain" />
                      </div>
                    )}

                    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-2 sm:px-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileVideo className="h-4 w-4 shrink-0" />
                        <span className="truncate text-xs font-medium text-foreground sm:text-sm" title={file.name}>
                          {file.name}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 border border-border sm:h-10 sm:w-10"
                              onClick={replaceFile}
                              aria-label="Заменить файл"
                            >
                              <Replace className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="center">
                            <p className="text-xs">Заменить файл</p>
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 border border-border text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                              onClick={clearFile}
                              aria-label="Удалить файл"
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="center">
                            <p className="text-xs">Удалить файл</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    <input ref={inputRef} type="file" accept=".mp4,.webm" className="hidden" onChange={onChange} />
                  </div>
                ) : mode === "upload" ? (
                  <div className={dropzoneClasses} onClick={() => inputRef.current?.click()}>
                    <div className="flex flex-col items-center px-3 text-center">
                      <div className="mb-4 rounded-full bg-muted/40 p-4 transition-colors group-hover:bg-muted/60">
                        <Upload className="h-8 w-8 text-muted-foreground/80 transition-colors group-hover:text-muted-foreground" />
                      </div>

                      <p className="hidden text-sm font-medium sm:block sm:text-base">Перетащите файл</p>

                      <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                        <span className="hidden sm:inline">или </span>
                        <span className="font-medium text-primary">Нажмите для выбора</span>
                        <br />
                        <span>(до {MAX_FILE_SIZE_MB} MB)</span>
                      </p>
                    </div>

                    <input ref={inputRef} type="file" accept=".mp4,.webm" className="hidden" onChange={onChange} />
                  </div>
                ) : (
                  <div
                    className={`
                    flex h-full flex-col overflow-hidden rounded-xl border transition-colors border-[2.5px]
                    ${permission === "denied" ? "border-destructive/20 bg-destructive/5" : "border-border"}
                  `}
                  >
                    <div className="relative min-h-0 flex-1 bg-muted/10">
                      <video ref={liveVideoRef} className="h-full w-full object-cover" playsInline muted />

                      {/* Timer (показываем в режиме записи, когда recorder подготовлен/запущен) */}
                      {recording && (
                        <div className="absolute left-2 top-2 rounded-lg border border-border bg-background/80 px-2 py-1 text-xs tabular-nums backdrop-blur">
                          <span
                            className={[
                              "mr-1 inline-flex h-2 w-2 rounded-full align-middle",
                              paused ? "bg-yellow-500" : "bg-red-500",
                            ].join(" ")}
                          />
                          {formatMMSS(recordSecs)}
                        </div>
                      )}

                      {/* Overlay: PAUSE (видео продолжает идти, но затемняется + текст) */}
                      {permission === "granted" && recording && paused && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                          <div className="text-2xl font-semibold">
                            На паузе
                          </div>
                        </div>
                      )}

                      {(permission === "idle" || permission === "requesting") && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/20 backdrop-blur-sm">
                          <div className="text-sm font-medium sm:text-base">Разрешите доступ к камере и микрофону</div>
                        </div>
                      )}

                      {permission === "denied" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/5">
                          <div className="text-sm font-medium text-destructive sm:text-base">
                            Доступ к камере и микрофону заблокирован
                            <p className="mt-2 text-xs font-medium text-destructive/80">
                              Проверьте настройки разрешений в браузере
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Record controls (below stage) */}
              {!file && (
                <div className="mt-4">
                  {mode === "upload" ? (
                    <>
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-1 bg-border" />

                        <div className="flex flex-col items-center">
                          <span className="text-lg font-semibold text-muted-foreground sm:text-xl">или</span>
                          <span className="text-lg font-semibold text-muted-foreground sm:text-xl">Запишите его сейчас</span>
                        </div>

                        <div className="h-px flex-1 bg-border" />
                      </div>

                      <div className="mt-4 flex flex-col items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={enterRecordMode}
                              disabled={loading || !supportsRecording}
                              className={[
                                "relative inline-flex items-center justify-center",
                                "h-18 w-18 rounded-full border-[2.5px]",
                                "transition-colors",
                                "disabled:cursor-not-allowed disabled:opacity-50",
                                "border-red-500/25 bg-red-500/10 hover:bg-red-500/20",
                              ].join(" ")}
                              aria-label="Начать запись"
                            >
                              <Video className="h-8 w-8 text-red-500 dark:text-red-400" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="center">
                            <p className="text-xs">Начать запись</p>
                          </TooltipContent>
                        </Tooltip>

                        {!supportsRecording && (
                          <div className="mt-1 text-[12px] text-muted-foreground">Запись недоступна в этом браузере</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            disabled={loading}
                            onClick={exitRecordMode}
                            className="rounded-full"
                            aria-label="Вернуться к загрузке"
                          >
                            <X className="h-6 w-6" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center">
                          <p className="text-xs">Вернуться к загрузке</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={togglePause}
                            disabled={loading || !recording}
                            className={[
                              "relative inline-flex items-center justify-center",
                              "h-18 w-18 rounded-full border-[2.5px] transition-colors",
                              "disabled:cursor-not-allowed disabled:opacity-50",
                              "border-red-500/25 bg-red-500/10 hover:bg-red-500/20",
                            ].join(" ")}
                            aria-label={recordButtonTooltip}
                          >
                            {isActivelyRecording && (
                              <span className="pointer-events-none absolute -inset-1 rounded-full border-4 border-red-500/25 animate-ping" />
                            )}
                            <span className="relative">
                              {paused ? (
                                <Play className="h-8 w-8 text-red-500 dark:text-red-400" />
                              ) : (
                                <Pause className="h-8 w-8 text-red-500 dark:text-red-400" />
                              )}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center">
                          <p className="text-xs">{recordButtonTooltip}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            disabled={loading}
                            onClick={restartRecording}
                            className="rounded-full"
                            aria-label="Перезаписать"
                          >
                            <RotateCcw className="h-6 w-6" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center">
                          <p className="text-xs">Перезаписать</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}

                  {error && <div className="mt-1 text-xs font-medium text-destructive">{error}</div>}
                </div>
              )}
            </div>
          </motion.div>

          {/* Settings + actions */}
          <motion.div variants={item} className="mt-4 flex justify-center">
            <div className="w-full max-w-lg">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:text-sm"
                    >
                      <CircleHelp className="h-4 w-4" />
                      Нужна помощь?
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" sideOffset={1} className="max-w-xs text-left">
                    <p className="text-xs leading-relaxed">
                      Форматы: .mp4, .webm.
                      <br />
                      Размер: до {MAX_FILE_SIZE_MB}MB.
                    </p>
                  </TooltipContent>
                </Tooltip>

                <button
                  type="button"
                  onClick={() => setSettingsOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:text-sm"
                >
                  <Settings className="h-4 w-4" />
                  Настройки
                  <motion.span
                    animate={{ rotate: settingsOpen ? 180 : 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </motion.span>
                </button>
              </div>

              <AnimatePresence initial={false}>
                {settingsOpen && (
                  <motion.div
                    key="settings-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 rounded-xl border border-border px-4 py-4 text-left">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs font-medium sm:text-sm">Модель транскрибации (Whisper)</Label>
                          <Select
                            value={settings.whisperModel}
                            onValueChange={(v) =>
                              setSettings((p) => ({ ...p, whisperModel: v as WhisperModel }))
                            }
                          >
                            <SelectTrigger className="mt-1 w-full text-xs sm:text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {WHISPER_MODELS.map((m) => (
                                <WhisperModelSelectItem
                                  key={m.value}
                                  value={m.value}
                                  label={m.label}
                                  description={m.description}
                                />
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="border-t border-border" />

                        <div className="flex items-center justify-between">
                          <Label htmlFor="diarization" className="flex flex-col gap-1">
                            <span className="text-xs font-medium leading-none sm:text-sm">Включить диаризацию</span>
                            <span className="text-[10px] text-muted-foreground sm:text-xs">
                              Разделение речи по говорящим
                            </span>
                          </Label>
                          <Switch
                            id="diarization"
                            checked={settings.diarization}
                            onCheckedChange={(checked) =>
                              setSettings((p) => ({ ...p, diarization: checked }))
                            }
                          />
                        </div>

                        <div className="border-t border-border" />

                        <div className="space-y-2">
                          <Label className="text-xs font-medium sm:text-sm">Модель анализа (ChatGPT)</Label>
                          <Select
                            value={settings.analysisModel}
                            onValueChange={(v) =>
                              setSettings((p) => ({ ...p, analysisModel: v as ChatGPTAnalysisModel }))
                            }
                          >
                            <SelectTrigger className="mt-1 w-full text-xs sm:text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CHATGPT_ANALYSIS_MODELS.map((m) => (
                                <SelectPrimitive.Item
                                  key={m.value}
                                  value={m.value}
                                  textValue={m.label}
                                  className={[
                                    "relative w-full cursor-default select-none rounded-sm",
                                    "py-2 pl-2 pr-8 outline-none",
                                    "focus:bg-accent focus:text-accent-foreground",
                                    "text-xs sm:text-sm",
                                  ].join(" ")}
                                >
                                  <SelectPrimitive.ItemText>
                                    <span className="font-medium">{m.label}</span>
                                  </SelectPrimitive.ItemText>
                                </SelectPrimitive.Item>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="border-t border-border" />

                        <div className="flex items-center justify-between">
                          <Label htmlFor="gaze-analysis" className="flex flex-col gap-1">
                            <span className="text-xs font-medium leading-none sm:text-sm">Включить анализ видео</span>
                            <span className="text-[10px] text-muted-foreground sm:text-xs">
                              Анализ направления взгляда
                            </span>
                          </Label>
                          <Switch
                            id="gaze-analysis"
                            checked={settings.gazeAnalysis}
                            onCheckedChange={(checked) =>
                              setSettings((p) => ({ ...p, gazeAnalysis: checked }))
                            }
                          />
                        </div>

                        <div className="border-t border-border" />

                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setCriteriaOpen((p) => !p)}
                            className="flex w-full items-center justify-between text-left"
                          >
                            <span className="text-xs font-medium sm:text-sm">Критерии</span>
                            <motion.span
                              animate={{ rotate: criteriaOpen ? 180 : 0 }}
                              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                              className="inline-flex text-muted-foreground"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </motion.span>
                          </button>

                          <AnimatePresence initial={false}>
                            {criteriaOpen && (
                              <motion.div
                                key="criteria-panel"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="mt-1 space-y-4 rounded-lg border border-border p-4">
                                  <div className="space-y-2">
                                    <Label className="text-xs font-medium sm:text-sm">
                                      Время выступления (в минутах)
                                    </Label>
                                    <div className="mt-1 flex items-center gap-2">
                                      <Input
                                        inputMode="numeric"
                                        type="number"
                                        min={0}
                                        step={1}
                                        placeholder="Не учитывать"
                                        value={speechDurationMinutesInput}
                                        onChange={(e) => setSpeechDurationMinutesInput(e.target.value)}
                                        className={[
                                          "flex-1 text-xs sm:text-sm",
                                          "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                        ].join(" ")}
                                      />
                                      <div className="flex shrink-0 items-center gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          onClick={() => {
                                            const cur = speechDurationMinutes ?? 0
                                            setSpeechDurationMinutesInput(String(Math.max(0, cur - 1)))
                                          }}
                                          className="h-8 w-8"
                                          aria-label="Уменьшить"
                                        >
                                          <Minus className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          onClick={() => {
                                            const cur = speechDurationMinutes ?? 0
                                            setSpeechDurationMinutesInput(String(cur + 1))
                                          }}
                                          className="h-8 w-8"
                                          aria-label="Увеличить"
                                        >
                                          <Plus className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="border-t border-border" />

                                  <div className="space-y-2">
                                    <Label className="text-xs font-medium sm:text-sm">
                                      Файл с критериями (txt/md/json)
                                    </Label>

                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="mt-1 h-auto w-full justify-start whitespace-normal py-2 text-left text-xs leading-snug sm:text-sm"
                                      onClick={() => criteriaInputRef.current?.click()}
                                    >
                                      <Upload className="h-4 w-4 shrink-0" />
                                      {criteriaFile
                                        ? `Критерии: ${criteriaFile.name}`
                                        : "Загрузить файл с критериями"}
                                    </Button>

                                    {criteriaFile && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        className="w-full justify-start text-xs sm:text-sm"
                                        onClick={() => setCriteriaFile(null)}
                                      >
                                        Удалить критерии
                                      </Button>
                                    )}

                                    <input
                                      ref={criteriaInputRef}
                                      type="file"
                                      accept=".txt,.md,.json"
                                      className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0] ?? null
                                        setCriteriaFile(f)
                                        e.target.value = ""
                                      }}
                                    />
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Bottom actions */}
          <motion.div variants={item} className="mt-4 flex justify-center">
            <div className="grid w-full max-w-lg grid-cols-2 gap-4">
              <Button asChild variant="outline" size="lg" className="w-full font-semibold">
                <Link href="/">Назад</Link>
              </Button>

              <motion.div
                whileHover={canStartAnalysis ? { scale: 1.05 } : {}}
                whileTap={canStartAnalysis ? { scale: 0.95 } : {}}
                className="w-full"
              >
                <Button
                  size="lg"
                  disabled={!canStartAnalysis}
                  className="w-full font-semibold"
                  onClick={handleStartAnalysis}
                >
                  Начать анализ
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
