export function parseGithubRepo(url: string) {
  try {
    const { pathname } = new URL(url)
    const parts = pathname.replace(/\/+$/, "").split("/")
    const owner = parts[1]
    const repo = parts[2]
    if (!owner || !repo) return null
    return { owner, repo }
  } catch {
    return null
  }
}

export async function getGithubStars(repoUrl: string): Promise<number | null> {
  const repo = parseGithubRepo(repoUrl)
  if (!repo) return null

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  }

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
    {
      headers,
      next: { revalidate: 3600 },
    }
  )

  if (!res.ok) return null

  const data = (await res.json()) as { stargazers_count?: number }
  return typeof data.stargazers_count === "number"
    ? data.stargazers_count
    : null
}
