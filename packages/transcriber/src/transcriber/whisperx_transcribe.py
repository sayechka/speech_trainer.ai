#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from time import perf_counter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cpu")  # cpu | cuda
    parser.add_argument(
        "--compute_type", default="int8"
    )  # int8 | float16 | float32 | int8_float16
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    audio_path = Path(args.audio)
    out_path = Path(args.output)

    if not audio_path.exists():
        print(f"Audio not found: {audio_path}", file=sys.stderr)
        return 2

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as e:
        print(
            "Failed to import faster_whisper. Install it in your python environment.\n"
            f"Original error: {e}",
            file=sys.stderr,
        )
        return 3

    t0 = perf_counter()
    try:
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
        )

        segments_iter, info = model.transcribe(
            str(audio_path),
            word_timestamps=True,  # <-- важно: тайминги слов
            vad_filter=True,  # ускоряет на паузах/тишине
            beam_size=1,  # быстрее (можно увеличить для качества)
        )

        segments = []
        text_parts = []

        for seg in segments_iter:
            seg_dict = {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text,
                "words": [],
            }

            # seg.words может быть None
            if getattr(seg, "words", None):
                for w in seg.words:
                    seg_dict["words"].append(
                        {
                            "word": w.word,
                            "start": float(w.start) if w.start is not None else None,
                            "end": float(w.end) if w.end is not None else None,
                            "probability": float(w.probability)
                            if getattr(w, "probability", None) is not None
                            else None,
                        }
                    )

            segments.append(seg_dict)

            t = (seg.text or "").strip()
            if t:
                text_parts.append(t)

        result = {
            "language": getattr(info, "language", None),
            "language_probability": float(getattr(info, "language_probability", 0.0))
            if getattr(info, "language_probability", None) is not None
            else None,
            "duration": float(getattr(info, "duration", 0.0))
            if getattr(info, "duration", None) is not None
            else None,
            "segments": segments,
            "text": " ".join(text_parts).strip(),
        }

    except Exception as e:
        print(f"faster-whisper transcribe failed: {e}", file=sys.stderr)
        return 4

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    dt = perf_counter() - t0
    print(
        json.dumps(
            {"ok": True, "seconds": round(dt, 2), "text_len": len(result["text"])},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
