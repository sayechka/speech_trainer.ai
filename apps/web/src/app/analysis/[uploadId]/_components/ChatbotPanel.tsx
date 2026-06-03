"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp } from "lucide-react"
import TextareaAutosize from "react-textarea-autosize"

import { Button } from "@/components/ui/button"

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "").trim()

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="OpenAI"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
    >
      <title>OpenAI icon</title>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  )
}

type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; status: "done" | "loading" }

type ChatApiResponse = { uploadId: string; model: string; message: { role: "assistant"; content: string } }

export default function ChatbotPanel({
  uploadId,
  modelLabel,
  model,
}: {
  uploadId: string
  modelLabel: string
  model: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid(),
      role: "assistant",
      status: "done",
      content:
        'Привет! Задайте мне вопрос по выступлению - я подробно отвечу на него, приведя примеры и таймкоды! Например, "Как избавиться от слов-паразитов"?',
    },
  ])

  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)

  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [messages.length])

  const canSend = input.trim().length > 0 && !busy

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return

    setBusy(true)
    setInput("")

    const userMsg: ChatMessage = { id: uid(), role: "user", content: text }
    const loadingId = uid()
    const loadingMsg: ChatMessage = { id: loadingId, role: "assistant", status: "loading", content: "" }
    setMessages((prev) => [...prev, userMsg, loadingMsg])

    try {
      const turns = [...messages, userMsg]
        .filter((m) => !(m.role === "assistant" && (m as any).status === "loading"))
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-14)

      const res = await fetch(`${API_BASE_URL}/uploads/${uploadId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: turns, maxOutputTokens: 700 }),
      })
      if (!res.ok) throw new Error(`chat_http_${res.status}`)

      const data = (await res.json()) as ChatApiResponse
      const answer = data?.message?.content ?? "Не удалось получить ответ."

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? { ...m, status: "done", content: answer } : m))
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId ? { ...m, status: "done", content: `Ошибка: ${msg}` } : m
        )
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-1 pb-4">
        <div className="flex items-center gap-2">
          <OpenAIIcon className="h-4 w-4 text-foreground" />
          <span className="text-sm text-foreground">{modelLabel}</span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={listRef} className="h-full overflow-y-auto px-2 pb-24">
          <div className="flex flex-col gap-4">
            {messages.map((m) => {
              const isUser = m.role === "user"
              const isLoading = m.role === "assistant" && m.status === "loading"
              const isError = m.role === "assistant" && !isLoading && m.content.trim().startsWith("Ошибка:")

              return (
                <div key={m.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
                  <div className="max-w-[90%]">
                    {isLoading ? (
                      <div className="text-xs text-muted-foreground">Создаём ответ…</div>
                    ) : isUser ? (
                      <div className="rounded-xl px-4 py-2 bg-muted/40 border border-muted/60 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                        {m.content}
                      </div>
                    ) : (
                      <div
                        className={[
                          "text-sm leading-relaxed whitespace-pre-wrap",
                          isError ? "text-red-400" : "text-foreground",
                        ].join(" ")}
                      >
                        {m.content}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-background via-background to-transparent pt-8">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            className="rounded-xl border border-border bg-background px-5 py-5 focus-within:border-foreground/20 transition-colors"
          >
            <div className="flex items-end gap-2">
              <TextareaAutosize
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                minRows={1}
                maxRows={5}
                placeholder="Напишите сообщение…"
                className="flex-1 resize-none bg-transparent text-foreground placeholder:text-muted-foreground text-sm leading-relaxed py-1 focus:outline-none"
              />

              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 rounded-lg"
                disabled={!canSend}
                aria-label="Отправить"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
