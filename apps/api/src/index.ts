import "dotenv/config"

import Fastify from "fastify"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"
import { createWriteStream, createReadStream } from "node:fs"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import {
  createJob,
  getJob,
  getJobEmitter,
  runSpeechPipelineJob,
  type JobEvent,
} from "./jobs.js"

import { ensureAiInsights, chatWithCoach, type AiInsights } from "./ai.js"

type AnyObj = Record<string, any>

const DEFAULT_CRITERIA_TEXT = `
Критерии качественного публичного выступления (эталон для рекомендаций):

1) Ясность и структура
- Понятная цель: зачем слушателю это важно.
- Логика: тезис → аргумент/пример → вывод.
- Переходы между блоками и краткие резюме.

2) Темп и управляемость речи
- Темп в зоне комфортного восприятия (ориентир 110–175 слов/мин).
- Ускорение на второстепенном, замедление на важном.
- Паузы как инструмент смысла, а не потеря мысли.

3) Чистота речи
- Минимум слов‑паразитов и самоповторов.
- Точность формулировок, меньше «размывания» мысли.
- Простой язык, конкретные формулировки.

4) Паузы и дыхание
- Паузы 0.5–1.5с — нормальны для акцента и дыхания.
- Слишком длинные паузы >2–3с — сигнал потери структуры; исправляем заранее подготовленными переходами.

5) Вариативность подачи (живость)
- Речь не должна быть монотонной: умеренная вариативность темпа/громкости на ключевых местах.
- Выделение главного голосом и паузой.

Формат результата:
- 2–4 предложения: краткий итог.
- 3–6 сильных сторон.
- 3–6 точек роста (самое важное сверху).
- 3–6 упражнений на ближайшую неделю (конкретных и измеримых).
`.trim()

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(multipart, {
  limits: { files: 1, fileSize: 550 * 1024 * 1024 },
})

app.get("/health", async () => ({ ok: true }))

type UploadEntry = {
  filepath: string
  filename: string
  mimetype: string

  audioFilepath?: string
  transcriptJsonFilepath?: string
  analysisJsonFilepath?: string

  criteriaFilepath?: string
  criteriaFilename?: string

  // settings
  analysisModel?: string
  whisperModel?: string
  diarization?: boolean
  gazeAnalysis?: boolean
  speechDurationMinutes?: number | null
}

const uploads = new Map<string, UploadEntry>()

// prevent double-spend on simultaneous AI calls
const aiLocks = new Map<string, Promise<AiInsights>>()

function repoRootFromHere() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // apps/api/src -> repoRoot
  return path.resolve(__dirname, "../../..")
}

// ── DEMO MODE ────────────────────────────────────────────────────────────────

if (process.env.DEMO_MODE === "1") {
  const root = repoRootFromHere()
  const demoDir = path.join(root, "apps/api/fixtures/demo")

  const demoId = "demo"
  uploads.set(demoId, {
    filepath: path.join(demoDir, "demo.mp4"),
    filename: "demo.mp4",
    mimetype: "video/mp4",
    transcriptJsonFilepath: path.join(demoDir, "demo.transcript.json"),
    analysisJsonFilepath: path.join(demoDir, "demo.analysis.json"),
    analysisModel: "gpt-5.4-mini",
    whisperModel: "small",
    diarization: false,
    gazeAnalysis: false,
  })

  app.log.info({ demoId, demoDir }, "DEMO_MODE enabled: registered demo upload")
}

// ── File upload ───────────────────────────────────────────────────────────────

app.post("/uploads", async (req, reply) => {
  const part = await req.file()
  if (!part) return reply.code(400).send({ error: "file_required" })

  const uploadId = randomUUID()

  const dir = path.join(tmpdir(), "ai-speech-trainer")
  await mkdir(dir, { recursive: true })

  const safeName = part.filename.replace(/[^\p{L}\p{N}._-]+/gu, "_")
  const filepath = path.join(dir, `${uploadId}-${safeName}`)

  await pipeline(part.file, createWriteStream(filepath))

  uploads.set(uploadId, { filepath, filename: part.filename, mimetype: part.mimetype })

  return reply.send({ uploadId, filename: part.filename, mimetype: part.mimetype })
})

// ── Criteria upload ───────────────────────────────────────────────────────────

app.post("/uploads/:id/criteria", async (req, reply) => {
  const { id } = req.params as { id: string }
  const upload = uploads.get(id)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const part = await req.file()
  if (!part) return reply.code(400).send({ error: "file_required" })

  const dir = path.dirname(upload.filepath)
  const safeName = part.filename.replace(/[^\p{L}\p{N}._-]+/gu, "_")
  const filepath = path.join(dir, `${id}-criteria-${safeName}`)

  await pipeline(part.file, createWriteStream(filepath))

  upload.criteriaFilepath = filepath
  upload.criteriaFilename = part.filename
  uploads.set(id, upload)

  return reply.send({ ok: true })
})

// ── Create job ────────────────────────────────────────────────────────────────

app.post("/jobs", async (req, reply) => {
  const body = (req.body ?? {}) as {
    uploadId?: unknown

    // preferred (from your upload/page.tsx)
    settings?: {
      whisperModel?: unknown
      analysisModel?: unknown
      diarization?: unknown
      gazeAnalysis?: unknown
      criteria?: { speechDurationMinutes?: unknown }
    }
    ui?: { steps?: unknown; stepDurationMs?: unknown }

    // backward compat (optional)
    steps?: unknown
    stepDurationMs?: unknown
    whisperModel?: unknown
    analysisModel?: unknown
  }

  const uploadId =
    typeof body.uploadId === "string" && body.uploadId.trim()
      ? body.uploadId.trim()
      : null
  if (!uploadId) return reply.code(400).send({ error: "uploadId is required" })

  const upload = uploads.get(uploadId)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const ui = body.ui ?? {}
  const stepsRaw = ui.steps ?? body.steps
  const steps =
    Array.isArray(stepsRaw) && stepsRaw.every((x) => typeof x === "string")
      ? (stepsRaw as string[])
      : null
  if (!steps || steps.length === 0) return reply.code(400).send({ error: "ui.steps is required" })

  const stepDurationMsRaw = ui.stepDurationMs ?? body.stepDurationMs
  const stepDurationMs =
    typeof stepDurationMsRaw === "number" && Number.isFinite(stepDurationMsRaw)
      ? stepDurationMsRaw
      : 1800

  const s = body.settings ?? {}

  const whisperModelRaw = s.whisperModel ?? body.whisperModel
  const whisperModel =
    typeof whisperModelRaw === "string" && whisperModelRaw.trim()
      ? whisperModelRaw.trim()
      : "small"

  const analysisModelRaw = s.analysisModel ?? body.analysisModel
  const analysisModel =
    typeof analysisModelRaw === "string" && analysisModelRaw.trim()
      ? analysisModelRaw.trim()
      : "gpt-5.4-mini"

  const diarization = s.diarization === true
  const gazeAnalysis = s.gazeAnalysis === true

  const speechDurationMinutes =
    typeof s.criteria?.speechDurationMinutes === "number" &&
    Number.isFinite(s.criteria.speechDurationMinutes)
      ? Math.max(0, Math.floor(s.criteria.speechDurationMinutes))
      : null

  const outDir = path.dirname(upload.filepath)
  const outputWavPath = path.join(outDir, `${uploadId}.wav`)
  const outputTranscriptJsonPath = path.join(outDir, `${uploadId}.transcript.json`)
  const outputAnalysisJsonPath = path.join(outDir, `${uploadId}.analysis.json`)

  upload.audioFilepath = outputWavPath
  upload.transcriptJsonFilepath = outputTranscriptJsonPath
  upload.analysisJsonFilepath = outputAnalysisJsonPath
  upload.analysisModel = analysisModel
  upload.whisperModel = whisperModel
  upload.diarization = diarization
  upload.gazeAnalysis = gazeAnalysis
  upload.speechDurationMinutes = speechDurationMinutes
  uploads.set(uploadId, upload)

  const job = createJob(steps)

  void runSpeechPipelineJob({
    jobId: job.id,
    uploadId,
    inputVideoPath: upload.filepath,
    outputWavPath,
    outputTranscriptJsonPath,
    outputAnalysisJsonPath,
    whisperModel,
    diarization,
    gazeAnalysis,
    stepDurationMs,
    pauseThresholdSec: 1.5,
  })

  return reply.send({ id: job.id })
})

// ── On-demand AI insights ─────────────────────────────────────────────────────

app.post("/uploads/:id/ai", async (req, reply) => {
  const { id } = req.params as { id: string }

  // Safety: do not spend in demo mode
  if (process.env.DEMO_MODE === "1" && id === "demo") {
    return reply.code(409).send({ error: "ai_disabled_in_demo" })
  }

  const upload = uploads.get(id)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const analysisPath = upload.analysisJsonFilepath
  const transcriptPath = upload.transcriptJsonFilepath
  if (!analysisPath) return reply.code(409).send({ error: "analysis_not_ready" })
  if (!transcriptPath) return reply.code(409).send({ error: "transcript_not_ready" })

  const body = (req.body ?? {}) as { model?: unknown; force?: unknown; maxOutputTokens?: unknown }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : (upload.analysisModel ?? "gpt-5.4-mini")

  const force = body.force === true

  const maxOutputTokens =
    typeof body.maxOutputTokens === "number" && Number.isFinite(body.maxOutputTokens)
      ? Math.max(200, Math.min(1200, Math.floor(body.maxOutputTokens)))
      : 900

  if (aiLocks.has(id)) {
    const ai = await aiLocks.get(id)!
    return reply.send({ uploadId: id, ai, inFlight: true })
  }

  const p = (async () => {
    const [rawA, rawT] = await Promise.all([
      readFile(analysisPath, "utf-8"),
      readFile(transcriptPath, "utf-8"),
    ])
    const analysisJson = JSON.parse(rawA) as AnyObj
    const transcriptJson = JSON.parse(rawT) as AnyObj

    let criteriaText: string | null = null
    if (upload.criteriaFilepath && /\.(txt|md|json)$/i.test(upload.criteriaFilepath)) {
      try {
        criteriaText = (await readFile(upload.criteriaFilepath, "utf-8")).trim().slice(0, 4000)
      } catch {
        criteriaText = null
      }
    }
    if (!criteriaText) criteriaText = DEFAULT_CRITERIA_TEXT.slice(0, 4000)

    const { ai, analysisJson: nextAnalysis, fromCache } = await ensureAiInsights({
      analysisJson,
      transcriptJson,
      criteriaText,
      model,
      force,
      maxOutputTokens,
    })

    if (!fromCache || force) {
      await writeFile(analysisPath, JSON.stringify(nextAnalysis, null, 2), "utf-8")
    }

    return ai
  })()

  aiLocks.set(id, p)

  try {
    const ai = await p
    return reply.send({ uploadId: id, ai })
  } catch (e) {
    return reply.code(502).send({
      error: "ai_failed",
      message: e instanceof Error ? e.message : String(e),
    })
  } finally {
    aiLocks.delete(id)
  }
})

// ── Chat with coach ──────────────────────────────────────────────────────────

app.post("/uploads/:id/chat", async (req, reply) => {
  const { id } = req.params as { id: string }

  // Safety: do not spend in demo mode
  if (process.env.DEMO_MODE === "1" && id === "demo") {
    return reply.code(409).send({ error: "chat_disabled_in_demo" })
  }

  const upload = uploads.get(id)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const analysisPath = upload.analysisJsonFilepath
  const transcriptPath = upload.transcriptJsonFilepath
  if (!analysisPath) return reply.code(409).send({ error: "analysis_not_ready" })
  if (!transcriptPath) return reply.code(409).send({ error: "transcript_not_ready" })

  const body = (req.body ?? {}) as { model?: unknown; messages?: unknown; maxOutputTokens?: unknown }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : (upload.analysisModel ?? "gpt-5.4-mini")

  const maxOutputTokens =
    typeof body.maxOutputTokens === "number" && Number.isFinite(body.maxOutputTokens)
      ? Math.max(150, Math.min(1200, Math.floor(body.maxOutputTokens)))
      : 700

  const [rawA, rawT] = await Promise.all([
    readFile(analysisPath, "utf-8"),
    readFile(transcriptPath, "utf-8"),
  ])
  const analysisJson = JSON.parse(rawA) as AnyObj
  const transcriptJson = JSON.parse(rawT) as AnyObj

  let criteriaText: string | null = null
  if (upload.criteriaFilepath && /\.(txt|md|json)$/i.test(upload.criteriaFilepath)) {
    try {
      criteriaText = (await readFile(upload.criteriaFilepath, "utf-8")).trim().slice(0, 4000)
    } catch {
      criteriaText = null
    }
  }
  if (!criteriaText) criteriaText = DEFAULT_CRITERIA_TEXT.slice(0, 4000)

  try {
    const { reply: text, usage } = await chatWithCoach({
      model,
      analysisJson,
      transcriptJson,
      criteriaText,
      messages: body.messages,
      maxOutputTokens,
    })

    return reply.send({
      uploadId: id,
      model,
      message: { role: "assistant", content: text },
      usage: usage ?? null,
    })
  } catch (e) {
    return reply.code(502).send({
      error: "chat_failed",
      message: e instanceof Error ? e.message : String(e),
    })
  }
})

// ── Video streaming (Range support) ──────────────────────────────────────────

app.get("/uploads/:id/video", async (req, reply) => {
  const { id } = req.params as { id: string }
  const upload = uploads.get(id)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const filepath = upload.filepath
  const mimetype = upload.mimetype || "application/octet-stream"

  const fileStat = await stat(filepath)
  const fileSize = fileStat.size
  const range = req.headers.range

  reply.header("Accept-Ranges", "bytes")
  reply.header("Content-Type", mimetype)

  if (!range) {
    reply.header("Content-Length", String(fileSize))
    return reply.send(createReadStream(filepath))
  }

  const m = /^bytes=(\d+)-(\d+)?$/.exec(range)
  if (!m) return reply.code(416).send({ error: "invalid_range" })

  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : fileSize - 1

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
    return reply.code(416).send({ error: "range_not_satisfiable" })
  }

  const safeEnd = Math.min(end, fileSize - 1)
  const chunkSize = safeEnd - start + 1

  reply.code(206)
  reply.header("Content-Range", `bytes ${start}-${safeEnd}/${fileSize}`)
  reply.header("Content-Length", String(chunkSize))

  return reply.send(createReadStream(filepath, { start, end: safeEnd }))
})

// ── Transcript / Analysis getters ─────────────────────────────────────────────

app.get("/uploads/:id/transcript", async (req, reply) => {
  const { id } = req.params as { id: string }
  const upload = uploads.get(id)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const p = upload.transcriptJsonFilepath
  if (!p) return reply.code(409).send({ error: "transcript_not_ready" })

  try {
    return reply.send({ uploadId: id, transcript: JSON.parse(await readFile(p, "utf-8")) })
  } catch (e) {
    return reply.code(500).send({ error: "failed_to_read_transcript", message: String(e) })
  }
})

app.get("/uploads/:id/analysis", async (req, reply) => {
  const { id } = req.params as { id: string }
  const upload = uploads.get(id)
  if (!upload) return reply.code(404).send({ error: "upload_not_found" })

  const p = (upload as any).analysisJsonFilepath as string | null | undefined
  if (!p) return reply.code(409).send({ error: "analysis_not_ready" })

  try {
    const analysisJson = JSON.parse(await readFile(p, "utf-8"))

    // Try to enrich with AI coach plan (cached in analysis.json)
    const transcriptPath = (upload as any).transcriptJsonFilepath as string | null | undefined
    if (transcriptPath) {
      const q = (req.query ?? {}) as any
      const model =
        typeof q.model === "string" && q.model.trim()
          ? q.model.trim()
          : (process.env.OPENAI_INSIGHTS_MODEL ??
              process.env.OPENAI_MODEL ??
              "gpt-5.4-mini")

      const force = String(q.force ?? "") === "1" || String(q.force ?? "").toLowerCase() === "true"

      // Criteria text (optional)
      let criteriaText: string | null = null
      const criteriaInline = (upload as any).criteriaText
      if (typeof criteriaInline === "string" && criteriaInline.trim()) {
        criteriaText = criteriaInline
      } else {
        const criteriaPath =
          ((upload as any).criteriaTextFilepath as string | null | undefined) ??
          ((upload as any).criteriaFilepath as string | null | undefined) ??
          ((upload as any).criteriaTxtFilepath as string | null | undefined) ??
          null

        if (criteriaPath) {
          try {
            criteriaText = await readFile(criteriaPath, "utf-8")
          } catch {}
        }
      }

      try {
        const transcriptJson = JSON.parse(await readFile(transcriptPath, "utf-8"))

        const { analysisJson: next, fromCache } = await ensureAiInsights({
          analysisJson,
          transcriptJson,
          criteriaText,
          model,
          force,
        })

        if (!fromCache) {
          await writeFile(p, JSON.stringify(next, null, 2), "utf-8")
        }

        return reply.send({ uploadId: id, analysis: next })
      } catch (e) {
        // If OpenAI missing / failed — just return base analysis
        ;(req as any).log?.warn?.({ err: e }, "ensureAiInsights failed")
      }
    }

    return reply.send({ uploadId: id, analysis: analysisJson })
  } catch (e) {
    return reply.code(500).send({ error: "failed_to_read_analysis", message: String(e) })
  }
})

// ── SSE job events ────────────────────────────────────────────────────────────

app.get("/jobs/:id/events", async (req, reply) => {
  const { id } = req.params as { id: string }

  const job = getJob(id)
  const emitter = getJobEmitter(id)
  if (!job || !emitter) return reply.code(404).send({ error: "not_found" })

  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8")
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform")
  reply.raw.setHeader("Connection", "keep-alive")
  reply.raw.setHeader("X-Accel-Buffering", "no")

  reply.hijack()
  reply.raw.flushHeaders?.()

  const send = (eventName: string, data: unknown) => {
    reply.raw.write(`event: ${eventName}\n`)
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  reply.raw.write(`retry: 2000\n\n`)
  send("snapshot", { status: job.status, step: job.step, steps: job.steps })

  if (job.status === "done") {
    send("done", { type: "done" })
    reply.raw.end()
    return
  }
  if (job.status === "error") {
    send("error", { type: "error", message: "Job failed" })
    reply.raw.end()
    return
  }

  const onEvent = (evt: JobEvent) => {
    if (evt.type === "progress") send("progress", evt)
    if (evt.type === "done") {
      send("done", evt)
      cleanup()
      reply.raw.end()
    }
    if (evt.type === "error") {
      send("error", evt)
      cleanup()
      reply.raw.end()
    }
  }

  emitter.on("event", onEvent)

  const ping = setInterval(() => {
    reply.raw.write(`: ping\n\n`)
  }, 15000)

  const cleanup = () => {
    clearInterval(ping)
    emitter.off("event", onEvent)
  }

  req.raw.on("close", cleanup)
})

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? "0.0.0.0"
await app.listen({ port, host })
