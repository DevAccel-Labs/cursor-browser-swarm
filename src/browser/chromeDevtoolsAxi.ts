export function axiUsageInstructions(baseUrl: string): string {
  return [
    "Use chrome-devtools-axi for browser validation when available:",
    `npx -y chrome-devtools-axi open ${baseUrl}`,
    "npx -y chrome-devtools-axi snapshot",
    "npx -y chrome-devtools-axi screenshot ./evidence.png",
    "npx -y chrome-devtools-axi console --type error --limit 50",
    "npx -y chrome-devtools-axi network --limit 50",
  ].join("\n");
}
