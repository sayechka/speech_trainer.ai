import { writeFile } from "node:fs/promises"
import { analyzeTranscriptFile } from "/home/user/Documents/ai-speech-trainer/apps/api/src/analysis.ts"

const WORD_DUR_SEC = 0.55
const PAUSE_SEC = 2

// 5 пауз по 2 секунды.
// Индексы слов zero-based: пауза ставится ПОСЛЕ слова.
const PAUSE_AFTER_WORD_INDEXES = new Set([39, 79, 119, 159, 179])

const SEGMENTS: string[][] = [
  [
    "Во-первых",
    "сегодня",
    "я",
    "расскажу",
    "план",
    "проекта",
    "э",
    "важно",
    "держать",
    "фокус",
    "важно",
    "держать",
    "фокус",
    "и",
    "начинать",
    "спокойно",
    "очень",
    "хорошо",
    "для",
    "команды",
  ],

  [
    "Во-вторых",
    "мы",
    "показываем",
    "задачу",
    "клиенту",
    "ну",
    "задача",
    "ясна",
    "задача",
    "ясна",
    "поэтому",
    "решение",
    "выглядит",
    "полезно",
    "и",
    "отлично",
    "уже",
    "сегодня",
    "для",
    "всех",
  ],

  [
    "В-третьих",
    "посмотрим",
    "риски",
    "типа",
    "если",
    "срок",
    "сдвинется",
    "это",
    "плохо",
    "но",
    "команда",
    "команда",
    "быстро",
    "найдет",
    "путь",
    "и",
    "сохранит",
    "темп",
    "проекта",
    "вместе",
  ],

  [
    "Сначала",
    "собираем",
    "факты",
    "эм",
    "факты",
    "нужны",
    "всем",
    "затем",
    "сравниваем",
    "варианты",
    "варианты",
    "без",
    "спешки",
    "потому",
    "что",
    "важно",
    "говорить",
    "честно",
    "каждый",
    "день",
  ],

  [
    "Далее",
    "я",
    "предложу",
    "решение",
    "эээ",
    "решение",
    "простое",
    "решение",
    "простое",
    "оно",
    "помогает",
    "снизить",
    "шум",
    "и",
    "делает",
    "работу",
    "максимально",
    "понятной",
    "для",
    "команды",
  ],

  [
    "Потом",
    "проверим",
    "эффект",
    "вот",
    "эффект",
    "виден",
    "сразу",
    "людям",
    "интересно",
    "и",
    "рад",
    "что",
    "результат",
    "становится",
    "очень",
    "стабильным",
    "и",
    "полезным",
    "для",
    "всех",
  ],

  [
    "Перейдем",
    "к",
    "примерам",
    "мм",
    "пример",
    "первый",
    "пример",
    "первый",
    "показывает",
    "где",
    "было",
    "ужасно",
    "и",
    "где",
    "стало",
    "хорошо",
    "после",
    "изменений",
    "за",
    "неделю",
  ],

  [
    "В",
    "итоге",
    "команда",
    "получила",
    "порядок",
    "э",
    "порядок",
    "важен",
    "порядок",
    "важен",
    "потому",
    "что",
    "сильные",
    "решения",
    "рождаются",
    "спокойно",
    "и",
    "точно",
    "каждый",
    "раз",
  ],

  [
    "Подведем",
    "итог",
    "цель",
    "понятна",
    "ну",
    "цель",
    "понятна",
    "шаги",
    "ясны",
    "шаги",
    "ясны",
    "и",
    "следующий",
    "спринт",
    "пройдет",
    "крайне",
    "спокойно",
    "для",
    "команды",
    "завтра",
  ],

  [
    "В",
    "заключение",
    "скажу",
    "главное",
    "э",
    "главное",
    "помнить",
    "людей",
    "главное",
    "помнить",
    "людей",
    "тогда",
    "проект",
    "звучит",
    "сильно",
    "интересно",
    "и",
    "хорошо",
    "для",
    "рынка",
  ],
]

function round2(n: number) {
  return Math.round(n * 100) / 100
}

async function main() {
  for (let i = 0; i < SEGMENTS.length; i++) {
    if (SEGMENTS[i].length !== 20) {
      throw new Error(`Segment ${i} has ${SEGMENTS[i].length} words, expected 20`)
    }
  }

  let t = 0
  let globalWordIndex = 0

  const segments = SEGMENTS.map((tokens, segmentIndex) => {
    const words = tokens.map((word, wordIndex) => {
      const start = round2(t)
      const end = round2(t + WORD_DUR_SEC)

      t += WORD_DUR_SEC

      if (PAUSE_AFTER_WORD_INDEXES.has(globalWordIndex)) {
        t += PAUSE_SEC
      }

      globalWordIndex++

      return {
        word,
        start,
        end,
        probability: 0.95,
      }
    })

    return {
      start: words[0].start,
      end: words[words.length - 1].end,
      text: tokens.join(" "),
      words,
    }
  })

  const transcript = {
    language: "ru",
    duration: 120,
    text: segments.map((s) => s.text).join(" "),
    segments,
  }

  const totalWords = segments.reduce((sum, s) => sum + s.words.length, 0)

  if (totalWords !== 200) {
    throw new Error(`Expected 200 words, got ${totalWords}`)
  }

  const lastWord = segments.at(-1)!.words.at(-1)!

  if (round2(lastWord.end) !== 120) {
    throw new Error(`Expected last word end = 120, got ${lastWord.end}`)
  }

  await writeFile(
    "demo.transcript.json",
    JSON.stringify(transcript, null, 2),
    "utf-8",
  )

  const analysis = await analyzeTranscriptFile({
    uploadId: "demo",
    transcriptJsonPath: "demo.transcript.json",
    outputAnalysisJsonPath: "demo.analysis.json",
    pauseThresholdSec: 1.5,
  })

  console.log("Created demo.transcript.json")
  console.log("Created demo.analysis.json")

  console.log({
    durationSec: analysis.metrics.durationSec,
    activeSpeechSec: analysis.metrics.activeSpeechSec,
    totalWords: analysis.metrics.totalWords,
    wordsPerMinute: analysis.metrics.wordsPerMinute,
    fillersTotal: analysis.metrics.fillersTotal,
    fillersPerMinute: analysis.metrics.fillersPerMinute,
    fillersPer100Words: analysis.metrics.fillersPer100Words,
    pausesTotal: analysis.metrics.pausesTotal,
    pauseTotalDuration: analysis.metrics.pauseTotalDuration,
    phraseRepetitionsTotal: analysis.metrics.phraseRepetitionsTotal,
    wordRepetitionsTotal: analysis.metrics.wordRepetitionsTotal,
    structureMarkersTotal: analysis.metrics.structureMarkersTotal,
    emotionalityScore: analysis.metrics.emotionalityScore,
    overallScore: analysis.metrics.overallScore,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
