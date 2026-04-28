import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { AgentAssignment, Finding } from "../types.js";

interface RepoContext {
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
  changedFiles: string[];
}

interface HandoffFinding {
  title: string;
  route: string;
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  classification?: Finding["classification"];
  rootCauseKey?: string;
  observedBehavior?: string;
  inferredCause?: string;
  fixReadiness?: Finding["fixReadiness"];
  protocolEvidence: string[];
  debugHints: string[];
  suggestedSearchTerms: string[];
  likelyFiles: string[];
  evidence: string[];
  reproSteps: string[];
}

interface HandoffPacket {
  version: "1";
  agentId: string;
  createdAt: string;
  repoPath: string;
  assignment: AgentAssignment;
  repoContext: RepoContext;
  findings: HandoffFinding[];
  notes: string[];
}

async function gitLines(repoPath: string, args: string[]): Promise<string[]> {
  let output = "";
  try {
    const result = await execa("git", args, {
      cwd: repoPath,
      reject: false,
      timeout: 10_000,
    });
    if (result.exitCode !== 0) {
      return [];
    }
    output = result.stdout;
  } catch {
    return [];
  }
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function parseStatusFiles(lines: string[], statusPredicate: (status: string) => boolean): string[] {
  return unique(
    lines.flatMap((line) => {
      const status = line.slice(0, 2);
      if (!statusPredicate(status)) {
        return [];
      }
      const file = line.slice(3).trim();
      return file ? [file.replace(/^"|"$/g, "")] : [];
    }),
  );
}

async function collectRepoContext(repoPath: string): Promise<RepoContext> {
  const [statusLines, unstagedFiles, stagedFiles] = await Promise.all([
    gitLines(repoPath, ["status", "--short"]),
    gitLines(repoPath, ["diff", "--name-only"]),
    gitLines(repoPath, ["diff", "--cached", "--name-only"]),
  ]);
  const untrackedFiles = parseStatusFiles(statusLines, (status) => status === "??");
  return {
    stagedFiles: unique(stagedFiles),
    unstagedFiles: unique(unstagedFiles),
    untrackedFiles,
    changedFiles: unique([...stagedFiles, ...unstagedFiles, ...untrackedFiles]),
  };
}

function extractProtocolTerms(text: string): string[] {
  const dottedTerms = text.match(/\b[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+\b/gi) ?? [];
  const tempTerms = text.match(/\btemp_[a-z0-9_-]+\b/gi) ?? [];
  return [...dottedTerms, ...tempTerms];
}

function suggestedSearchTerms(finding: Finding): string[] {
  const combined = [
    finding.title,
    finding.observedBehavior,
    finding.inferredCause,
    ...(finding.protocolEvidence ?? []),
    ...(finding.debugHints ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const terms = extractProtocolTerms(combined);
  if (
    /\b(?:websocket|realtime|socket|ack|optimistic|temp_|reconcile|persistence)\b/i.test(combined)
  ) {
    terms.push("sendOperation", "replaceCardId", "ack", "snapshot", "temp_");
  }
  return unique([...terms, ...(finding.likelyFiles ?? [])]);
}

function toHandoffFinding(finding: Finding): HandoffFinding {
  return {
    title: finding.title,
    route: finding.route,
    severity: finding.severity,
    confidence: finding.confidence,
    ...(finding.classification ? { classification: finding.classification } : {}),
    ...(finding.rootCauseKey ? { rootCauseKey: finding.rootCauseKey } : {}),
    ...(finding.observedBehavior ? { observedBehavior: finding.observedBehavior } : {}),
    ...(finding.inferredCause ? { inferredCause: finding.inferredCause } : {}),
    ...(finding.fixReadiness ? { fixReadiness: finding.fixReadiness } : {}),
    protocolEvidence: finding.protocolEvidence ?? [],
    debugHints: finding.debugHints ?? [],
    suggestedSearchTerms: suggestedSearchTerms(finding),
    likelyFiles: finding.likelyFiles,
    evidence: finding.evidence,
    reproSteps: finding.reproSteps,
  };
}

export async function writeHandoffPacket(input: {
  handoffPath: string;
  agentId: string;
  repoPath: string;
  assignment: AgentAssignment;
  findings: Finding[];
  notes: string[];
}): Promise<void> {
  const packet: HandoffPacket = {
    version: "1",
    agentId: input.agentId,
    createdAt: new Date().toISOString(),
    repoPath: input.repoPath,
    assignment: input.assignment,
    repoContext: await collectRepoContext(input.repoPath),
    findings: input.findings.map(toHandoffFinding),
    notes: input.notes,
  };
  await mkdir(path.dirname(input.handoffPath), { recursive: true });
  await writeFile(input.handoffPath, `${JSON.stringify(packet, null, 2)}\n`);
}
