import argparse
import json
import math
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import List, Optional, Literal, Dict, Any, Tuple

import cv2
import numpy as np
import mediapipe as mp

GazeKind = Literal["camera", "away_left", "away_right", "away_down", "unknown"]


@dataclass
class FrameObs:
    t: float
    kind: GazeKind
    yaw: Optional[float]
    pitch: Optional[float]
    face_found: bool


def run_ffmpeg_preprocess(
    input_path: str, output_path: str, fps: float, width: int
) -> None:
    # Stable decode for mp4/webm: scale down + fixed fps + no audio
    # Requires ffmpeg installed.
    args = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input_path,
        "-an",
        "-vf",
        f"fps={fps},scale={width}:-2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        output_path,
    ]
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if p.returncode != 0:
        raise RuntimeError(
            p.stderr.strip() or f"ffmpeg exited with code {p.returncode}"
        )


def rotation_matrix_to_euler_yaw_pitch(R: np.ndarray) -> Tuple[float, float]:
    # R is 3x3. Return yaw (Y axis) and pitch (X axis) in degrees.
    # Using a common convention; sign may vary but thresholds work in practice.
    sy = math.sqrt(R[0, 0] * R[0, 0] + R[1, 0] * R[1, 0])
    singular = sy < 1e-6

    if not singular:
        x = math.atan2(R[2, 1], R[2, 2])  # pitch-ish
        y = math.atan2(-R[2, 0], sy)  # yaw-ish
    else:
        x = math.atan2(-R[1, 2], R[1, 1])
        y = math.atan2(-R[2, 0], sy)

    pitch = math.degrees(x)
    yaw = math.degrees(y)
    return yaw, pitch


def estimate_headpose_yaw_pitch(
    image_rgb: np.ndarray,
    face_landmarks: Any,
) -> Optional[Tuple[float, float]]:
    h, w = image_rgb.shape[0], image_rgb.shape[1]

    # Selected FaceMesh landmark indices (widely used for head pose):
    # nose tip: 1, chin: 152, left eye outer: 33, right eye outer: 263,
    # mouth left: 61, mouth right: 291
    idxs = [1, 152, 33, 263, 61, 291]
    pts2d = []
    for i in idxs:
        lm = face_landmarks.landmark[i]
        pts2d.append((lm.x * w, lm.y * h))
    image_points = np.array(pts2d, dtype=np.float64)

    # Generic 3D model points (approximate). Units are arbitrary but consistent.
    model_points = np.array(
        [
            (0.0, 0.0, 0.0),  # nose tip
            (0.0, -63.0, -12.0),  # chin
            (-43.0, 32.0, -26.0),  # left eye outer
            (43.0, 32.0, -26.0),  # right eye outer
            (-28.0, -28.0, -24.0),  # mouth left
            (28.0, -28.0, -24.0),  # mouth right
        ],
        dtype=np.float64,
    )

    focal_length = float(w)
    center = (w / 2.0, h / 2.0)
    camera_matrix = np.array(
        [[focal_length, 0, center[0]], [0, focal_length, center[1]], [0, 0, 1]],
        dtype=np.float64,
    )
    dist_coeffs = np.zeros((4, 1), dtype=np.float64)

    ok, rvec, tvec = cv2.solvePnP(
        model_points,
        image_points,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        return None

    R, _ = cv2.Rodrigues(rvec)
    yaw, pitch = rotation_matrix_to_euler_yaw_pitch(R)

    # We mostly care about magnitude and "pitch down". Clamp insane values.
    if not (math.isfinite(yaw) and math.isfinite(pitch)):
        return None

    yaw = float(max(-90.0, min(90.0, yaw)))
    pitch = float(max(-90.0, min(90.0, pitch)))
    return yaw, pitch


def classify_kind(
    yaw: Optional[float], pitch: Optional[float], yaw_deg: float, pitch_down_deg: float
) -> GazeKind:
    if yaw is None or pitch is None:
        return "unknown"

    if pitch > pitch_down_deg:
        return "away_down"

    if yaw > yaw_deg:
        return "away_right"
    if yaw < -yaw_deg:
        return "away_left"

    return "camera"


def merge_runs(
    frames: List[FrameObs], fps: float, min_event_sec: float, max_events: int
) -> List[Dict[str, Any]]:
    if not frames:
        return []

    dt = 1.0 / max(0.1, fps)

    # Consider only face_found frames for events; unknown breaks.
    events = []
    cur_kind: Optional[GazeKind] = None
    cur_start = 0.0
    cur_yaws: List[float] = []
    cur_pitchs: List[float] = []
    cur_face = False

    def flush(end_t: float):
        nonlocal cur_kind, cur_start, cur_yaws, cur_pitchs, cur_face
        if cur_kind in ("away_left", "away_right", "away_down") and cur_face:
            dur = max(0.0, end_t - cur_start)
            if dur >= min_event_sec:
                avg_yaw = float(np.mean(cur_yaws)) if cur_yaws else None
                avg_pitch = float(np.mean(cur_pitchs)) if cur_pitchs else None
                events.append(
                    {
                        "startSec": round(cur_start, 2),
                        "endSec": round(end_t, 2),
                        "durationSec": round(dur, 2),
                        "kind": cur_kind,
                        "avgYaw": round(avg_yaw, 1) if avg_yaw is not None else None,
                        "avgPitch": round(avg_pitch, 1)
                        if avg_pitch is not None
                        else None,
                    }
                )
        cur_kind = None
        cur_yaws = []
        cur_pitchs = []
        cur_face = False

    for fr in frames:
        if not fr.face_found or fr.kind == "unknown":
            if cur_kind is not None:
                flush(fr.t)
            continue

        if cur_kind is None:
            cur_kind = fr.kind
            cur_start = fr.t
            cur_face = True
        elif fr.kind != cur_kind:
            flush(fr.t)
            cur_kind = fr.kind
            cur_start = fr.t
            cur_face = True

        if fr.yaw is not None:
            cur_yaws.append(fr.yaw)
        if fr.pitch is not None:
            cur_pitchs.append(fr.pitch)

    if cur_kind is not None:
        flush(frames[-1].t + dt)

    events.sort(key=lambda e: e["durationSec"], reverse=True)
    return events[:max_events]


def score_from_stats(look_away_share: float, longest_away_sec: float) -> float:
    # 100 is best. Penalize share and long streak.
    s = 100.0
    s -= 70.0 * max(0.0, min(1.0, look_away_share))  # 0..70
    s -= 30.0 * max(0.0, min(1.0, longest_away_sec / 8.0))  # 0..30
    return float(max(0.0, min(100.0, s)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--yawDeg", type=float, default=25.0)
    ap.add_argument("--pitchDownDeg", type=float, default=18.0)
    ap.add_argument("--minEventSec", type=float, default=2.5)
    ap.add_argument("--maxEvents", type=int, default=10)
    args = ap.parse_args()

    video_in = args.video
    out_path = args.output
    fps = float(max(1.0, min(12.0, args.fps)))
    width = int(max(240, min(1280, args.width)))

    yaw_deg = float(max(5.0, min(45.0, args.yawDeg)))
    pitch_down_deg = float(max(5.0, min(45.0, args.pitchDownDeg)))
    min_event_sec = float(max(0.5, min(20.0, args.minEventSec)))
    max_events = int(max(1, min(25, args.maxEvents)))

    with tempfile.TemporaryDirectory() as td:
        pre_mp4 = os.path.join(td, "pre.mp4")
        run_ffmpeg_preprocess(video_in, pre_mp4, fps=fps, width=width)

        cap = cv2.VideoCapture(pre_mp4)
        if not cap.isOpened():
            raise RuntimeError("Failed to open preprocessed video")

        # Duration estimate
        src_fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        duration_sec = float(frame_count / src_fps) if src_fps and frame_count else 0.0

        mp_face_mesh = mp.solutions.face_mesh
        frames: List[FrameObs] = []

        with mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as fm:
            i = 0
            while True:
                ok, frame_bgr = cap.read()
                if not ok:
                    break
                t = i / max(1e-6, src_fps) if src_fps else (len(frames) / fps)
                i += 1

                # We preprocessed to fixed fps already, so read every frame.
                rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

                res = fm.process(rgb)
                if not res.multi_face_landmarks:
                    frames.append(
                        FrameObs(
                            t=float(t),
                            kind="unknown",
                            yaw=None,
                            pitch=None,
                            face_found=False,
                        )
                    )
                    continue

                face = res.multi_face_landmarks[0]
                yp = estimate_headpose_yaw_pitch(rgb, face)
                if yp is None:
                    frames.append(
                        FrameObs(
                            t=float(t),
                            kind="unknown",
                            yaw=None,
                            pitch=None,
                            face_found=True,
                        )
                    )
                    continue

                yaw, pitch = yp
                kind = classify_kind(
                    yaw, pitch, yaw_deg=yaw_deg, pitch_down_deg=pitch_down_deg
                )
                frames.append(
                    FrameObs(
                        t=float(t), kind=kind, yaw=yaw, pitch=pitch, face_found=True
                    )
                )

        cap.release()

        face_found = sum(1 for f in frames if f.face_found)
        total = max(1, len(frames))
        face_found_share = face_found / total

        away = sum(
            1
            for f in frames
            if f.face_found and f.kind in ("away_left", "away_right", "away_down")
        )
        look_away_share = away / max(1, face_found)

        events = merge_runs(
            frames, fps=fps, min_event_sec=min_event_sec, max_events=max_events
        )
        longest = max([e["durationSec"] for e in events], default=0.0)

        score100 = score_from_stats(look_away_share, longest)

        # Confidence: mostly depends on how often we see the face
        confidence = float(max(0.0, min(1.0, face_found_share)))
        if duration_sec > 0 and duration_sec < 10:
            confidence *= 0.7

        out: Dict[str, Any] = {
            "version": "gaze-v1-mediapipe-headpose",
            "sampleFps": fps,
            "width": width,
            "yawDeg": yaw_deg,
            "pitchDownDeg": pitch_down_deg,
            "minEventSec": min_event_sec,
            "durationSec": round(duration_sec, 2),
            "framesTotal": int(total),
            "faceFoundShare": round(face_found_share, 3),
            "lookAwayShare": round(look_away_share, 3),
            "lookAwayLongestStreakSec": round(float(longest), 2),
            "events": events,
            "score100": round(float(score100), 1),
            "confidence": round(confidence, 3),
        }

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
