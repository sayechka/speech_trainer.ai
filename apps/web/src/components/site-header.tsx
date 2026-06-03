import Link from "next/link"
import { Github, Star } from "lucide-react"

import { siteConfig } from "@/config/site"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { getGithubStars } from "@/lib/github"

async function GithubStars() {
  const stars = await getGithubStars(siteConfig.github)

  return (
    <>
      <Github className="h-5 w-5" />
      <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
      <span className="tabular-nums">
        {stars === null ? "—" : stars.toLocaleString("ru-RU")}
      </span>
    </>
  )
}

export async function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-background backdrop-blur">
      <div className="mx-auto flex h-12 items-center justify-between px-4">
        <Link href="/" className="font-semibold">
          {siteConfig.name}
        </Link>

        <div className="flex items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2"
          >
            <a href={siteConfig.github} target="_blank" rel="noopener noreferrer">
              <GithubStars />
            </a>
          </Button>

          <Separator orientation="vertical" className="h-4" />

          <ModeToggle />

          <Separator orientation="vertical" className="h-4" />
        </div>
      </div>
    </header>
  )
}
