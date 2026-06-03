"use client"

import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"

type LoadingState = {
  text: string
}

const CheckIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={cn("h-5 w-5", className)}
    >
      <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  )
}

const CheckFilled = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-5 w-5", className)}
    >
      <path
        fillRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

const LoaderCore = ({
  loadingStates,
  value = 0,
}: {
  loadingStates: LoadingState[]
  value?: number
}) => {
  return (
    <div className="relative mx-auto mt-30 flex max-w-xl flex-col justify-start px-6">
      {loadingStates.map((loadingState, index) => {
        const distance = Math.abs(index - value)
        const opacity = Math.max(1 - distance * 0.2, 0)

        return (
          <motion.div
            key={index}
            className={cn("mb-4 flex items-start gap-2 text-left")}
            initial={{ opacity: 0, y: -(value * 40) }}
            animate={{ opacity: opacity, y: -(value * 40) }}
            transition={{ duration: 0.5 }}
          >
            <div className="pt-0.5">
              {index > value && (
                <CheckIcon className="text-black dark:text-white" />
              )}
              {index <= value && (
                <CheckFilled
                  className={cn(
                    "text-black dark:text-white",
                    value === index && "text-black opacity-100 dark:text-white"
                  )}
                />
              )}
            </div>

            <span
              className={cn(
                // на телефоне на 2px меньше, как в остальных компонентах
                "text-sm sm:text-lg",
                "leading-snug sm:leading-normal",
                // \n показываем как перенос только на мобиле
                "whitespace-pre-line",
                "break-words",
                "text-black dark:text-white",
                value === index && "opacity-100"
              )}
            >
              {loadingState.text}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

export const MultiStepLoader = ({
  loadingStates,
  loading,
  duration = 2000,
  loop = true,
  value,
}: {
  loadingStates: LoadingState[]
  loading?: boolean
  duration?: number
  loop?: boolean
  value?: number
}) => {
  const [currentState, setCurrentState] = useState(0)

  useEffect(() => {
    if (typeof value === "number") {
      setCurrentState(value)
    }
  }, [value])

  useEffect(() => {
    if (typeof value === "number") return

    if (!loading) {
      setCurrentState(0)
      return
    }

    const timeout = setTimeout(() => {
      setCurrentState((prevState) =>
        loop
          ? prevState === loadingStates.length - 1
            ? 0
            : prevState + 1
          : Math.min(prevState + 1, loadingStates.length - 1)
      )
    }, duration)

    return () => clearTimeout(timeout)
  }, [currentState, loading, loop, loadingStates.length, duration, value])

  return (
    <AnimatePresence mode="wait">
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex h-full w-full items-center justify-center backdrop-blur-xl"
        >
          <div className="absolute inset-0 bg-white/50 dark:bg-black/60" />

          <div
            className="
              absolute inset-0
              bg-black/60 dark:bg-black/70
              [mask-image:radial-gradient(900px_at_center,transparent_35%,white)]
              [-webkit-mask-image:radial-gradient(900px_at_center,transparent_35%,white)]
            "
          />

          <div className="relative z-10 h-[24rem]">
            <LoaderCore value={currentState} loadingStates={loadingStates} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
