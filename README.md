# AI Speech Trainer

## Назначение

**AI Speech Trainer** — веб‑приложение для анализа публичного выступления по видеофайлу (или записи с камеры). Система выполняет технический анализ речи (темп, паузы, слова‑паразиты, повторы, вариативность громкости), опционально анализирует направление взгляда по видео, а также предоставляет AI‑разбор **смысла** выступления и краткий **план тренировки**.

Проект состоит из Next.js‑клиента и Fastify‑API, а обработка видео/аудио выполняется через `ffmpeg` и Python‑модули.

---

## Функциональные возможности

### 1) Обработка видео

- Приём видео `.mp4` и `.webm`.
- Извлечение аудио из видео в WAV (mono, 16 kHz).

### 2) Транскрибация

- Транскрибация аудио с **таймкодами слов** (для анализа пауз, темпа и повторов).
- Выгрузка результата в `*.transcript.json`.

### 3) Аналитика речи (delivery‑метрики)

- Темп (WPM) и таймсерии темпа.
- Паузы (количество, средняя/макс/медиана, доля пауз во времени).
- Слова‑паразиты (частота, доля, топ‑список).
- Повторы (фразовые и словарные).
- Вариативность громкости (таймсерия dB и статистики).
- Эвристики: “структурированность” по маркерам (во‑первых/итак/в итоге и т.п.), “эмоциональность” (лексика + вариативность).

Результат сохраняется в `*.analysis.json`.

### 4) Анализ взгляда (опционально)

- Детекция “смотрит в камеру / отводит взгляд влево/вправо/вниз”.
- События “look away” с таймкодами.
- Итоговый score и confidence.
- Результат добавляется в `analysis.json` в поле `analysis.video.gaze`.
- Ошибка gaze‑анализа **не должна** ломать весь пайплайн: сохраняется в `analysis.video.gazeError`.

### 5) AI‑разбор и чат‑коуч (опционально)

- `POST /uploads/:id/ai` — генерация AI‑инсайтов (по смыслу) + короткий “coach plan” (упражнения на 10 минут). Результат кэшируется в `analysis.json` (`analysis.ai`).
- `POST /uploads/:id/chat` — чат с тренером по контексту транскрипта/анализа.

---

## Структура репозитория

- `apps/api` — Fastify API (Node.js/TypeScript, ES Modules).
- `apps/web` — Next.js Web UI (React).
- `packages/transcriber` — Python‑пакет транскрибации (пишет transcript JSON).
- `packages/gaze_analyzer` — Python‑пакет анализа взгляда (пишет gaze JSON).

---

## Техническая архитектура (упрощённо)

1. **Загрузка**: UI → `POST /uploads` (multipart) → файл сохраняется во временную директорию ОС.
2. **Создание job**: UI → `POST /jobs` (JSON с настройками и описанием шагов лоадера).
3. **Пайплайн обработки**:
   - `ffmpeg` → `*.wav`
   - Python transcriber → `*.transcript.json`
   - TypeScript analyzer → `*.analysis.json` (+ таймсерии, громкость по wav)
   - (опционально) Python gaze analyzer → `*.gaze.json` → merge в `*.analysis.json`
4. **Прогресс**: UI подписывается на SSE: `GET /jobs/:id/events`.
5. **Получение результата**: UI читает `/uploads/:id/transcript` и `/uploads/:id/analysis`, при необходимости вызывает `/uploads/:id/ai` и `/uploads/:id/chat`.

---

## Требования к окружению

### Node.js

- Node.js: **20+** (рекомендуется LTS).
- npm: используется для workspaces и скриптов запуска.

### Внешние зависимости ОС

- `ffmpeg` должен быть доступен в `PATH`.

Проверка:

```bash
ffmpeg -version
```

### Python (для транскрибации и gaze‑анализа)

- Python: **3.10+** (рекомендуется 3.11).
- Рекомендуется `uv` (для установки/запуска Python‑пакетов из `packages/*`).

---

## Установка

### 1) Установка Node‑зависимостей

В корне репозитория:

```bash
npm install
```

### 2) Установка Python‑зависимостей (uv)

Транскрибация:

```bash
uv sync --project packages/transcriber
```

Анализ взгляда (только если планируется `gazeAnalysis=true`):

```bash
uv sync --project packages/gaze_analyzer
```

---

## Конфигурация окружения

### 1) API: файл `apps/api/.env` (обязательно для AI‑функций)

Создайте файл `apps/api/.env` и укажите:

```env
OPENAI_API_KEY=YOUR_KEY_HERE
```

Дополнительные параметры (опционально):

```env
PORT=4000
HOST=0.0.0.0

# Чем запускать Python-пакеты:
TRANSCRIBE_BIN=uv
GAZE_BIN=uv

# Демо-режим (опционально):
# DEMO_MODE=1
```

Пояснения:

- `OPENAI_API_KEY` — требуется для `POST /uploads/:id/ai` и `POST /uploads/:id/chat`.
- `DEMO_MODE=1` — включает предзагруженный demo uploadId и отключает AI‑траты для demo.

### 2) Web: переменная `NEXT_PUBLIC_API_URL` (опционально)

По умолчанию UI обращается к `http://localhost:4000`. Для явной настройки создайте `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## Запуск в разработке

В корне репозитория предусмотрен единый запуск (см. корневой `package.json`: `concurrently` + npm workspaces):

```bash
npm run dev
```

Дополнительно:

```bash
npm run dev:api
npm run dev:web
```

Ожидаемые адреса:

- Web: `http://localhost:3000`
- API: `http://localhost:4000/health`

---

## Сборка и запуск в production

### API

```bash
npm --workspace apps/api run build
npm --workspace apps/api run start
```

### Web

```bash
npm --workspace apps/web run build
npm --workspace apps/web run start
```

Важно:

- В production UI должен иметь корректный `NEXT_PUBLIC_API_URL`, указывающий на публично доступный API.
- SSE (`/jobs/:id/events`) требует корректной настройки прокси (не буферизовать ответы; например, `X-Accel-Buffering: no` уже выставляется API).

---

## API (контракты)

### Проверка доступности

**GET** `/health`

Ответ:

```json
{ "ok": true }
```

### Загрузка видео

**POST** `/uploads` (multipart/form-data, поле `file`)

Ответ:

```json
{ "uploadId": "...", "filename": "...", "mimetype": "..." }
```

### Загрузка файла критериев

**POST** `/uploads/:id/criteria` (multipart/form-data, поле `file`)

Поддерживаемые расширения (ожидаемо): `.txt`, `.md`, `.json`.

Ответ:

```json
{ "ok": true }
```

### Создание задачи обработки

**POST** `/jobs` (application/json)

Минимальная форма (пример):

```json
{
  "uploadId": "…",
  "ui": {
    "steps": [
      "Извлечение аудио",
      "Транскрибация",
      "Анализ",
      "Подготовка результата"
    ],
    "stepDurationMs": 1800
  },
  "settings": {
    "whisperModel": "small",
    "analysisModel": "gpt-5.4-mini",
    "diarization": false,
    "gazeAnalysis": false,
    "criteria": { "speechDurationMinutes": null }
  }
}
```

Ответ:

```json
{ "id": "jobId" }
```

### Прогресс обработки (SSE)

**GET** `/jobs/:id/events`

События:

- `snapshot`: `{ status, step, steps }`
- `progress`: `{ type:"progress", step, text }`
- `done`: `{ type:"done" }`
- `error`: `{ type:"error", message }`

### Получить видео (с поддержкой Range)

**GET** `/uploads/:id/video`

### Получить транскрипт

**GET** `/uploads/:id/transcript`

Ответ:

```json
{ "uploadId": "…", "transcript": { "...": "..." } }
```

### Получить анализ

**GET** `/uploads/:id/analysis`

Ответ:

```json
{ "uploadId": "…", "analysis": { "...": "..." } }
```

Примечание:

- Эндпоинт может попытаться обогатить анализ AI‑инсайтами (в зависимости от настроек/ключа).

### AI‑инсайты по запросу (кэшируются)

**POST** `/uploads/:id/ai`

Тело (опционально):

```json
{ "model": "gpt-5.4-mini", "force": false, "maxOutputTokens": 900 }
```

Ответ:

```json
{ "uploadId": "…", "ai": { "...": "..." } }
```

### Чат‑коуч

**POST** `/uploads/:id/chat`

Тело:

```json
{
  "model": "gpt-5.4-mini",
  "messages": [{ "role": "user", "content": "..." }],
  "maxOutputTokens": 700
}
```

Ответ:

```json
{
  "uploadId": "…",
  "model": "…",
  "message": { "role": "assistant", "content": "..." },
  "usage": null
}
```

---

## Форматы данных (ожидаемо)

### `*.transcript.json`

- `segments[]`: `{ start, end, text, words[] }`
- `words[]`: `{ word, start, end, probability }`
- `text`, `language`, `duration`

Ключевое требование: наличие `words[].start/end` (таймкоды слов).

### `*.analysis.json`

- `metrics`: агрегаты и вычисленные показатели, включая таймсерии
- `fillers`, `repetitions`, `wordRepetitions`, `pauses`
- (опционально) `video.gaze` или `video.gazeError`
- (опционально) `ai` — результат AI‑инсайтов (кэшируется)

### `*.gaze.json`

- `faceFoundShare`, `lookAwayShare`, `events[]`
- `score100`, `confidence`
- параметры препроцессинга и пороги классификации

---

## Ограничения и эксплуатационные свойства

### Хранение состояния

- `uploads` и `jobs` хранятся **в памяти процесса API**.
- После рестарта API:
  - активные jobs теряются,
  - ранее выданные `uploadId` могут стать недоступны.

### Хранение файлов

- Загруженные файлы и результаты сохраняются во временную директорию ОС (`tmpdir()/ai-speech-trainer`).
- Очистка временных файлов ОС может удалить данные. Для production рекомендуется заменить хранение на устойчивое (S3/диск/БД) и добавить lifecycle/GC.

### Лимиты размеров

- UI ограничивает размер примерно **500MB**.
- API ограничивает multipart размер (конфигурация Fastify) примерно **550MB**.

### CORS

- API разрешает CORS с `origin: true` (подходит для разработки; для production рекомендуется ограничить источники).

---

## Типовые ошибки и диагностика

### Ошибки `ffmpeg`

Причина: `ffmpeg` отсутствует или недоступен в `PATH`.
Проверка:

```bash
ffmpeg -version
```

### `OPENAI_API_KEY is missing`

Причина: не задан ключ.
Решение: создать `apps/api/.env` и указать `OPENAI_API_KEY`.

### `uv: command not found`

Причина: `uv` не установлен.
Решение:

- установить `uv`, либо
- задать `TRANSCRIBE_BIN` / `GAZE_BIN` на корректный бинарник запуска Python.

### Gaze‑анализ не работает

Проверьте:

- установлен ли пакет `packages/gaze_analyzer` через `uv sync`,
- наличие `ffmpeg`,
- совместимость `mediapipe`/`opencv` с вашей ОС и версией Python.

---

## Правовой статус

Репозиторий помечен как приватный (`private: true`). Условия использования определяются владельцем проекта.
