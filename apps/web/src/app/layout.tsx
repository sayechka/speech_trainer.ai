import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="relative min-h-screen">
        <ThemeProvider>
          <TooltipProvider>
            <div className="relative flex min-h-screen flex-col pt-14">
              <SiteHeader />
              <main className="mx-auto w-full flex-1">{children}</main>
              <SiteFooter />
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
