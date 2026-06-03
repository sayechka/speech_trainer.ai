"use client"

import Link from "next/link"
import { motion } from "motion/react"
import { ArrowUpRight, Github } from "lucide-react"

import { Button } from "@/components/ui/button"
import { siteConfig } from "@/config/site"
import { FlipWords } from "@/components/ui/flip-words"

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      delayChildren: 0.08,
      staggerChildren: 0.12,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.4, 0, 0.2, 1],
    },
  },
}

export default function HomePage() {
  return (
    <section className="relative flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-8">
      <div className="mx-auto w-full max-w-3xl pt-24 text-center">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.a
            variants={item}
            href={siteConfig.github}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border px-4 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground sm:text-base"
          >
            <Github className="h-4 w-4" />
            Исходный код на GitHub
            <ArrowUpRight className="h-4 w-4" />
          </motion.a>

          <motion.h1
            variants={item}
            className="text-4xl font-bold tracking-tight sm:text-6xl"
          >
            {siteConfig.name}
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-4 text-lg font-semibold leading-relaxed text-muted-foreground sm:text-2xl"
          >
            <span className="block">Подготовим к выступлению:</span>

            <span className="block">
              <FlipWords
                words={[
                  "уберём слова‑паразиты",
                  "поставим паузы",
                  "сделаем речь выразительнее",
                  "дадим рекомендации",
                ]}
                duration={2400}
              />
              <br className="sm:hidden" />
              <span className="sm:inline"> — чтобы вас слушали.</span>
            </span>
          </motion.p>

          <motion.div
            variants={item}
            className="mt-8 flex justify-center"
          >
            <div className="grid w-full max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="w-full"
              >
                <Button asChild size="lg" className="w-full font-semibold">
                  <Link href="/upload">Загрузить видео</Link>
                </Button>
              </motion.div>
          
              <Button
                asChild
                variant="outline"
                size="lg"
                className="w-full font-semibold"
              >
                <Link href="/about">Как это работает</Link>
              </Button>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
