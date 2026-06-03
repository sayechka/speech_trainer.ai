"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const tooltipText = "Сменить тему"

  if (!mounted) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={tooltipText}
              disabled
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={tooltipText}
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
        </Button>
      </TooltipTrigger>

      <TooltipContent side="bottom" align="center">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
