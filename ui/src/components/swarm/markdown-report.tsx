import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, ChevronRight, Clipboard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const EVIDENCE_HEADING_PATTERN = /^##\s+Evidence\b.*$/im
const NEXT_H2_PATTERN = /\n##\s+/m
const EVIDENCE_LABEL_PATTERN = /^Evidence:\s*$/i
const LIST_ITEM_PATTERN = /^\s*[-*+]\s+\S/
const INDENTED_CONTINUATION_PATTERN = /^\s{2,}\S/

interface MarkdownReportProps {
  markdown: string
  className?: string
}

type MarkdownSection =
  | {
      type: "markdown"
      markdown: string
    }
  | {
      type: "evidence"
      title: string
      body: string
    }

interface TopLevelEvidenceSection {
  before: string
  title: string
  body: string
  after: string
}

function splitTopLevelEvidenceSection(markdown: string): TopLevelEvidenceSection | null {
  const headingMatch = markdown.match(EVIDENCE_HEADING_PATTERN)

  if (!headingMatch || headingMatch.index === undefined) {
    return null
  }

  const headingStart = headingMatch.index
  const headingEnd = headingStart + headingMatch[0].length
  const rest = markdown.slice(headingEnd)
  const nextHeadingMatch = rest.match(NEXT_H2_PATTERN)
  const sectionEnd =
    nextHeadingMatch?.index === undefined
      ? markdown.length
      : headingEnd + nextHeadingMatch.index + 1

  return {
    before: markdown.slice(0, headingStart).trimEnd(),
    title: headingMatch[0].replace(/^##\s+/, "").trim(),
    body: markdown.slice(headingEnd, sectionEnd).trim(),
    after: markdown.slice(sectionEnd).trimStart(),
  }
}

function splitInlineEvidenceSections(markdown: string): Array<MarkdownSection> {
  const sections: Array<MarkdownSection> = []
  const lines = markdown.split("\n")
  let markdownStart = 0
  let currentLine = 0

  while (currentLine < lines.length) {
    if (!EVIDENCE_LABEL_PATTERN.test(lines[currentLine].trim())) {
      currentLine += 1
      continue
    }

    let evidenceEnd = currentLine + 1

    while (
      evidenceEnd < lines.length &&
      (LIST_ITEM_PATTERN.test(lines[evidenceEnd]) ||
        INDENTED_CONTINUATION_PATTERN.test(lines[evidenceEnd]))
    ) {
      evidenceEnd += 1
    }

    if (evidenceEnd === currentLine + 1) {
      currentLine += 1
      continue
    }

    const markdownBefore = lines.slice(markdownStart, currentLine).join("\n").trimEnd()

    if (markdownBefore) {
      sections.push({ type: "markdown", markdown: markdownBefore })
    }

    sections.push({
      type: "evidence",
      title: "Evidence",
      body: lines.slice(currentLine + 1, evidenceEnd).join("\n").trim(),
    })

    markdownStart = evidenceEnd
    currentLine = evidenceEnd
  }

  const markdownAfter = lines.slice(markdownStart).join("\n").trim()

  if (markdownAfter) {
    sections.push({ type: "markdown", markdown: markdownAfter })
  }

  return sections
}

function MarkdownChunk({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
}

function CollapsedEvidence({
  title,
  body,
}: {
  title: string
  body: string
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")

  const copyEvidence = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(body)
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
    window.setTimeout(() => setCopyState("idle"), 2000)
  }

  return (
    <details className="group rounded-md border border-border/70 bg-background/40 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 items-start gap-2">
          <ChevronRight
            className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
            aria-hidden
          />
          {title}
        </span>
        <Button
          variant="outline"
          size="xs"
          type="button"
          className="shrink-0 text-xs font-normal"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={copyEvidence}
          aria-label={
            copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed — try again"
                : `Copy ${title}`
          }
        >
          {copyState === "copied" ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <Clipboard className="size-3" aria-hidden />
          )}
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Failed"
              : "Copy"}
        </Button>
      </summary>
      <div className="mt-4">
        <MarkdownChunk markdown={body} />
      </div>
    </details>
  )
}

export function MarkdownReport({ markdown, className }: MarkdownReportProps) {
  const topLevelEvidenceSection = splitTopLevelEvidenceSection(markdown)
  const sections = topLevelEvidenceSection
    ? [
        ...splitInlineEvidenceSections(topLevelEvidenceSection.before),
        {
          type: "evidence" as const,
          title: topLevelEvidenceSection.title,
          body: topLevelEvidenceSection.body,
        },
        ...splitInlineEvidenceSections(topLevelEvidenceSection.after),
      ]
    : splitInlineEvidenceSections(markdown)

  return (
    <div
      className={cn(
        "[&>*:first-child]:mt-0 [&>*+*]:mt-5",
        "prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-p:leading-relaxed",
        "prose-p:my-3",
        "dark:prose-invert",
        "prose-h1:mb-4 prose-h1:text-xl prose-h1:scroll-mt-16 prose-h1:pb-2 prose-h1:border-b prose-h1:border-border",
        "prose-h2:mt-6 prose-h2:mb-2 prose-h2:text-base prose-h2:scroll-mt-16 prose-h2:pt-1 prose-h2:border-b prose-h2:border-border/60 prose-h2:pb-1",
        "prose-h3:mt-5 prose-h3:mb-2 prose-h3:text-sm prose-h3:scroll-mt-16",
        "prose-h4:mt-4 prose-h4:mb-1.5",
        "prose-code:rounded-md prose-code:border prose-code:border-border prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-foreground prose-code:break-all prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:p-3 prose-pre:text-xs prose-pre:overflow-x-auto",
        "prose-a:text-primary prose-a:underline-offset-4 hover:prose-a:text-primary/90",
        "prose-hr:my-5 prose-hr:border-border",
        "prose-blockquote:my-3 prose-blockquote:border-border prose-blockquote:py-1",
        "[&_ul]:my-3 [&_ol]:my-3 [&_ul>li+li]:mt-1.5 [&_ol>li+li]:mt-1.5 prose-li:marker:text-muted-foreground",
        "prose-th:border prose-th:border-border prose-th:px-2.5 prose-th:py-1.5 prose-td:border prose-td:border-border prose-td:px-2.5 prose-td:py-1.5 prose-table:my-4",
        className,
      )}
    >
      {sections.length > 0 ? (
        <>
          {sections.map((section, index) =>
            section.type === "evidence" ? (
              <CollapsedEvidence
                key={`${section.title}-${index}`}
                title={section.title}
                body={section.body}
              />
            ) : (
              <MarkdownChunk key={index} markdown={section.markdown} />
            )
          )}
        </>
      ) : (
        <MarkdownChunk markdown={markdown} />
      )}
    </div>
  )
}
