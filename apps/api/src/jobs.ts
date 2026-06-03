import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"

import { analyzeTranscriptFile } from "./analysis.js"
import { analyzeGazeFile } from "./gaze.js"

export type JobStatus = "queued" | "running" | "done" | "error"

export type JobProgressEvent = {
  type: "progress"
  step: number
  text: string
}

export type JobDoneEvent = { type: "done" }

export type JobErrorEvent = {
  type: "error"
  message: string
}

export type JobEvent = JobProgressEvent | JobDoneEvent | JobErrorEvent

export type Job = {
  id: string
  status: JobStatus
  step: number
  steps: string[]
  createdAt: number
}

type JobEntry = {
  job: Job
  emitter: EventEmitter
}

const jobs = new Map<string, JobEntry>()

export function createJob(steps: string[]) {
  const id = randomUUID()
  const job: Job = {
    id,
    status: "queued",
    step: 0,
    steps,
    createdAt: Date.now(),
  }

  jobs.set(id, { job, emitter: new EventEmitter() })
  return job
}

export function getJob(id: string) {
  return jobs.get(id)?.job ?? null
}

export function getJobEmitter(id: string) {
  return jobs.get(id)?.emitter ?? null
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function extractAudioWav(opts: { inputVideoPath: string; outputWavPath: string }) {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    opts.inputVideoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "wav",
    opts.outputWavPath,
  ]

  await new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })

    let stderr = ""
    p.stderr.on("data", (chunk) => (stderr += chunk.toString()))

    p.on("error", reject)
    p.on("close", (code) => {
      if (code === 0) return resolve()
      reject(new Error(stderr || `ffmpeg exited with code ${code}`))
    })
  })
}

async function transcribeWhisperX(opts: {
  audioPath: string
  outputJsonPath: string
  model: string
  diarization: boolean
}) {
  // Requires: uv + uv sync --project packages/transcriber
  const uv = process.env.TRANSCRIBE_BIN ?? "uv"

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // repoRoot/apps/api/src -> repoRoot/packages/transcriber
  const transcriberProject = path.resolve(__dirname, "../../../packages/transcriber")

  const args = [
    "run",
    "--project",
    transcriberProject,
    "python",
    "-m",
    "transcriber.whisperx_transcribe",
    "--audio",
    opts.audioPath,
    "--model",
    opts.model,
    "--device",
    "cpu",
    "--compute_type",
    "int8",
    "--output",
    opts.outputJsonPath,
  ]

  if (opts.diarization) args.push("--diarize")

  await new Promise<void>((resolve, reject) => {
    const p = spawn(uv, args, { stdio: ["ignore", "ignore", "pipe"] })

    let stderr = ""
    p.stderr.on("data", (chunk) => (stderr += chunk.toString()))

    p.on("error", reject)
    p.on("close", (code) => {
      if (code === 0) return resolve()
      reject(new Error(stderr || `transcribe exited with code ${code}`))
    })
  })
}

async function mergeGazeIntoAnalysisJson(opts: {
  analysisJsonPath: string
  gazeJsonPath: string
  gazeError?: string | null
}) {
  const rawA = await readFile(opts.analysisJsonPath, "utf-8")
  const analysis = JSON.parse(rawA) as any
  analysis.video = analysis.video && typeof analysis.video === "object" ? analysis.video : {}

  if (opts.gazeError) {
    analysis.video.gazeError = String(opts.gazeError)
  } else {
    const rawG = await readFile(opts.gazeJsonPath, "utf-8")
    analysis.video.gaze = JSON.parse(rawG)
  }

  await writeFile(opts.analysisJsonPath, JSON.stringify(analysis, null, 2), "utf-8")
}

export async function runSpeechPipelineJob(opts: {
  jobId: string
  uploadId: string

  inputVideoPath: string
  outputWavPath: string
  outputTranscriptJsonPath: string
  outputAnalysisJsonPath: string

  whisperModel: string
  diarization: boolean
  gazeAnalysis: boolean

  stepDurationMs: number
  pauseThresholdSec?: number
}) {
  const entry = jobs.get(opts.jobId)
  if (!entry) return

  const { job, emitter } = entry

  const MIN_STEP_MS = 1000
  let lastProgressAt = 0

  const emitProgress = (step: number) => {
    job.step = step
    const text = job.steps[step] ?? `Step ${step + 1}`
    emitter.emit("event", { type: "progress", step, text } satisfies JobProgressEvent)
    lastProgressAt = Date.now()
  }

  const ensureMinStepVisible = async () => {
    if (!lastProgressAt) return
    const dt = Date.now() - lastProgressAt
    if (dt < MIN_STEP_MS) await sleep(MIN_STEP_MS - dt)
  }

  // Step indices must match ui.steps sent from frontend:
  // - without gaze: [extract, transcribe, analyze transcript, prepare]
  // - with gaze:    [extract, transcribe, analyze transcript, analyze video, prepare]
  const STEP_EXTRACT = 0
  const STEP_TRANSCRIBE = 1
  const STEP_ANALYZE_TRANSCRIPT = 2
  const STEP_ANALYZE_VIDEO = opts.gazeAnalysis ? 3 : null
  const STEP_PREPARE = opts.gazeAnalysis ? 4 : 3

  job.status = "running"
  job.step = 0

  try {
    await sleep(150)

    // STEP 0 — extract audio
    if (job.steps.length >= STEP_EXTRACT + 1) emitProgress(STEP_EXTRACT)
    await extractAudioWav({
      inputVideoPath: opts.inputVideoPath,
      outputWavPath: opts.outputWavPath,
    })
    await ensureMinStepVisible()

    // STEP 1 — transcription
    if (job.steps.length >= STEP_TRANSCRIBE + 1) emitProgress(STEP_TRANSCRIBE)
    await transcribeWhisperX({
      audioPath: opts.outputWavPath,
      outputJsonPath: opts.outputTranscriptJsonPath,
      model: opts.whisperModel,
      diarization: opts.diarization,
    })
    await ensureMinStepVisible()

    // STEP 2 — transcript analysis (+ timeseries, loudness from wav)
    if (job.steps.length >= STEP_ANALYZE_TRANSCRIPT + 1) emitProgress(STEP_ANALYZE_TRANSCRIPT)
    await analyzeTranscriptFile({
      uploadId: opts.uploadId,
      transcriptJsonPath: opts.outputTranscriptJsonPath,
      outputAnalysisJsonPath: opts.outputAnalysisJsonPath,
      pauseThresholdSec: opts.pauseThresholdSec ?? 1.5,
      audioWavPath: opts.outputWavPath,
    })
    await ensureMinStepVisible()

    // STEP 3 (optional) — video gaze analysis (does NOT fail the job)
    if (opts.gazeAnalysis && STEP_ANALYZE_VIDEO != null) {
      if (job.steps.length >= STEP_ANALYZE_VIDEO + 1) emitProgress(STEP_ANALYZE_VIDEO)

      const outDir = path.dirname(opts.outputAnalysisJsonPath)
      const gazeJsonPath = path.join(outDir, `${opts.uploadId}.gaze.json`)

      try {
        await analyzeGazeFile({
          videoPath: opts.inputVideoPath,
          outputJsonPath: gazeJsonPath,
          fps: 5,
          width: 640,
          yawDeg: 25,
          pitchDownDeg: 18,
          minEventSec: 2.5,
          maxEvents: 10,
        })

        await mergeGazeIntoAnalysisJson({
          analysisJsonPath: opts.outputAnalysisJsonPath,
          gazeJsonPath,
        })
      } catch (e) {
        // attach error for debugging/UI, but don't fail the pipeline
        try {
          await mergeGazeIntoAnalysisJson({
            analysisJsonPath: opts.outputAnalysisJsonPath,
            gazeJsonPath,
            gazeError: e instanceof Error ? e.message : String(e),
          })
        } catch {
          // ignore completely
        }
      }

      await ensureMinStepVisible()
    }

    // STEP last — prepare result (just to make the step visible)
    if (job.steps.length >= STEP_PREPARE + 1) {
      emitProgress(STEP_PREPARE)
      await sleep(Math.max(MIN_STEP_MS, opts.stepDurationMs ?? 0))
      await ensureMinStepVisible()
    }

    job.status = "done"
    emitter.emit("event", { type: "done" } satisfies JobDoneEvent)
  } catch (e) {
    job.status = "error"
    emitter.emit("event", {
      type: "error",
      message: e instanceof Error ? e.message : "Unknown error",
    } satisfies JobErrorEvent)
  }
}
