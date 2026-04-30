import type { Finding } from "../types.js";

export function isToolingFinding(finding: Finding): boolean {
  return finding.findingKind === "harness-issue" || finding.classification === "tooling";
}

export function isOutOfScopeObservation(finding: Finding): boolean {
  return finding.findingKind === "out-of-scope-observation";
}

export function isScenarioBlocked(finding: Finding): boolean {
  return (
    finding.findingKind === "scenario-blocked" ||
    finding.needsCleanRepro === true ||
    finding.classification === "needs-clean-repro"
  );
}

export function isProductBug(finding: Finding): boolean {
  if (isToolingFinding(finding) || isOutOfScopeObservation(finding) || isScenarioBlocked(finding)) {
    return false;
  }
  if (finding.findingKind === "product-bug") {
    return true;
  }
  return (
    finding.classification === "independent-bug" ||
    finding.classification === "root-cause-candidate"
  );
}

export function isReportableApplicationIssue(finding: Finding): boolean {
  return isProductBug(finding);
}
