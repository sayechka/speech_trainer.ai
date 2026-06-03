import { siteConfig } from "@/config/site";
import { Copyright } from "lucide-react";

export function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto w-full px-4 py-8 text-center text-xs text-muted-foreground sm:text-sm">
        <p>
          <Copyright className="mr-1 inline-block h-3.5 w-3.5 sm:h-4 sm:w-4" />
          {new Date().getFullYear()} {siteConfig.name}.
          <br className="sm:hidden" /> Исходный код доступен на{" "}
          <a
            href={siteConfig.github}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2 transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
