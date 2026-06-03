import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

export type GazeAnalysisJson = {
  version: string
  sampleFps: number
  width: number
  yawDeg: number
  pitchDownDeg: number
  minEventSec: number

  durationSec: number
  framesTotal: number
  faceFoundShare: number

  lookAwayShare: number
  lookAwayLongestStreakSec: number

  events: Array<{
    startSec: number
    endSec: number
    durationSec: number
    kind: "away_left" | "away_right" | "away_down"
    avgYaw: number | null
    avgPitch: number | null
  }>

  score100: number
  confidence: number
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    p.stderr.on("data", (chunk) => (stderr += chunk.toString()))
    p.on("error", reject)
    p.on("close", (code) => {
      if (code === 0) return resolve()
      reject(new Error(stderr || `command failed: ${cmd} ${args.join(" ")}`))
    })
  })
}

export async function analyzeGazeFile(opts: {
  videoPath: string
  outputJsonPath: string
  fps?: number
  width?: number
  yawDeg?: number
  pitchDownDeg?: number
  minEventSec?: number
  maxEvents?: number
}) {
  const uv = process.env.GAZE_BIN ?? "uv"

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // repoRoot/apps/api/src -> repoRoot/packages/gaze_analyzer
  const gazeProject = path.resolve(__dirname, "../../../packages/gaze_analyzer")

  const args = [
    "run",
    "--project",
    gazeProject,
    "python",
    "-m",
    "gaze_analyzer.mediapipe_headpose",
    "--video",
    opts.videoPath,
    "--output",
    opts.outputJsonPath,
    "--fps",
    String(opts.fps ?? 5),
    "--width",
    String(opts.width ?? 640),
    "--yawDeg",
    String(opts.yawDeg ?? 25),
    "--pitchDownDeg",
    String(opts.pitchDownDeg ?? 18),
    "--minEventSec",
    String(opts.minEventSec ?? 2.5),
    "--maxEvents",
    String(opts.maxEvents ?? 10),
  ]

  await run(uv, args)
}
