"use client";
import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export const FlipWords = ({
  words,
  duration = 3000,
  className,
}: {
  words: string[];
  duration?: number;
  className?: string;
}) => {
  const [currentWord, setCurrentWord] = useState(words[0]);
  const [isAnimating, setIsAnimating] = useState(false);

  const startAnimation = useCallback(() => {
    const next = words[words.indexOf(currentWord) + 1] || words[0];
    setCurrentWord(next);
    setIsAnimating(true);
  }, [currentWord, words]);

  useEffect(() => {
    if (isAnimating) return;

    const t = window.setTimeout(() => {
      startAnimation();
    }, duration);

    return () => window.clearTimeout(t);
  }, [isAnimating, duration, startAnimation]);

  const parts = currentWord.split(" ");

  return (
    <span
      className={cn(
        "relative inline-block align-baseline text-[inherit] leading-[inherit] font-[inherit]",
        className
      )}
    >
      <AnimatePresence onExitComplete={() => setIsAnimating(false)} mode="popLayout">
        <motion.span
          key={currentWord}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 100, damping: 10 }}
          exit={{
            opacity: 0,
            y: -20,
            x: 20,
            filter: "blur(5px)",
            scale: 1,
            position: "absolute",
            left: 0,
            top: 0,
          }}
          className="inline-block whitespace-nowrap text-[inherit] leading-[inherit] font-[inherit]"
        >
          {parts.map((word, wordIndex) => (
            <motion.span
              key={word + wordIndex}
              initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: wordIndex * 0.3, duration: 0.3 }}
              className="inline-block whitespace-nowrap"
            >
              {word.split("").map((letter, letterIndex) => (
                <motion.span
                  key={word + letterIndex}
                  initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{
                    delay: wordIndex * 0.3 + letterIndex * 0.05,
                    duration: 0.2,
                  }}
                  className="inline-block"
                >
                  {letter}
                </motion.span>
              ))}
              {wordIndex < parts.length - 1 ? (
                <span className="inline-block">&nbsp;</span>
              ) : null}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};
