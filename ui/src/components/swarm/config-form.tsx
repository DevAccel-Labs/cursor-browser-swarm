import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  Copy,
  Play,
  Plus,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import type {
  AgentPersonaOption,
  DefaultsResponse,
  FormState,
  RouteInput,
  SecretInput,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface ConfigFormProps {
  defaults: DefaultsResponse | null
  isRunning: boolean
  onSubmit: (state: FormState) => void
  onCancel: () => void
}

const defaultInstructions = `Use the test account credentials from env vars.
Focus on console errors, failed network requests, visual breakage, and repro steps.`

type ShareableConfig = Omit<FormState, "secrets">

const assignmentStrategyOptions = ["replicate", "split"]
const modeOptions = ["cursor-cli", "copilot-cli", "custom-cli"]
const chromeModeOptions = ["axi", "devtools-mcp"]
const cursorFallbackModels = [{ id: "composer-2-fast", name: "Composer 2 Fast" }]
const copilotFallbackModels = [
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  { id: "auto", name: "Auto" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "gpt-4.1", name: "GPT-4.1" },
  { id: "gpt-5-mini", name: "GPT-5 mini" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.2-codex", name: "GPT-5.2-Codex" },
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
  { id: "gpt-5.5", name: "GPT-5.5" },
]
const genericFallbackModels = [{ id: "auto", name: "Auto" }]

function getShareableConfig(formState: FormState): ShareableConfig {
  const { secrets: _secrets, ...config } = formState
  return config
}

function formatConfig(formState: FormState) {
  return JSON.stringify(getShareableConfig(formState), null, 2)
}

function getConfiguredModelOptions(defaults: DefaultsResponse | null) {
  const models = defaults?.models.length
    ? defaults.models
    : [{ id: "composer-2-fast", name: "Composer 2 Fast" }]

  return models.map((model) => ({
    value: model.id,
    label: model.name,
  }))
}

function fallbackModelsForMode(mode: string) {
  switch (mode) {
    case "cursor-cli":
      return cursorFallbackModels
    case "copilot-cli":
      return copilotFallbackModels
    case "custom-cli":
    default:
      return genericFallbackModels
  }
}

function fallbackModelForMode(mode: string) {
  return fallbackModelsForMode(mode)[0]?.id ?? "auto"
}

function getConfigurationGuide(defaults: DefaultsResponse | null) {
  return {
    purpose:
      "This bundle describes a Cursor Browser Swarm validation run. Edit only the config section, then paste that config back into the UI or use it as the POST body shape for a run.",
    curationGuidance: [
      "Base scenarios on concrete product surfaces, routes, and acceptance criteria from the feature being validated.",
      "Do not invent browser tools, MCP servers, CLI flags, API routes, personas, modes, models, or dropdown values that are not listed in this guide.",
      "Prefer specific route goals over broad instructions. A good goal names the user journey, important states, and failure modes to inspect.",
      "Keep credentials out of copied config. The UI has a separate Credentials section for secrets.",
      "Use agentDirectives for custom validation perspectives when built-in agentPersonas are not enough.",
    ],
    fields: {
      baseUrl:
        "Root URL of the running app under test. Agents navigate from this origin and append each route path.",
      appName:
        "Human-readable app name used in run labels and reports. It does not change browser behavior.",
      routes:
        "Array of scenarios. Each item has path and goal. path should be a concrete app route like /dashboard. goal should explain what to validate on that route.",
      instructions:
        "Global instructions every agent receives in addition to each route goal. Use this for auth notes, feature context, known risk areas, and what evidence to collect.",
      agents:
        "Requested number of validation agents. Higher values increase coverage and cost/runtime. Recomended 3-4 agents.",
      agentConcurrency:
        "How many agents may run at once. Use auto for the app default, or a numeric string such as 1, 2, 4, or 8.",
      agentConcurrencyManual:
        "True when the concurrency value was manually edited. Usually leave as false when agentConcurrency is auto.",
      assignmentStrategy:
        "replicate sends every route to each agent for redundant perspectives. split divides routes across agents for breadth.",
      agentPersonas:
        "Array of built-in persona IDs. Use only persona IDs listed under options.agentPersonas. Leave empty for general validation.",
      agentDirectives:
        "Custom persona instructions, one per line as id=Instructions. Use short stable IDs like auth=Probe permission boundaries.",
      mode: "Execution backend. Use one of options.modes.",
      chromeMode:
        "Browser automation integration. Use one of options.chromeModes.",
      model: "Agent model ID. Use one of options.models.",
      agentCommand:
        "CLI command invoked for the selected agent mode. Cursor defaults to agent; Copilot defaults to copilot.",
      cursorCommand:
        "Deprecated alias for agentCommand. Prefer agentCommand in new configs.",
      maxRouteSteps:
        "Maximum browser/tool steps per route before an agent should stop and report.",
      axiPortBase:
        "Optional base port for AXI browser automation. Empty string means auto.",
      noDevServer:
        "True when the target app is already running and the swarm should not try to start it.",
    },
    options: {
      assignmentStrategy: [
        {
          value: "replicate",
          meaning:
            "Every active agent validates every route. Best when you want multiple independent passes.",
        },
        {
          value: "split",
          meaning:
            "Routes are distributed across agents. Best when many routes need broad coverage quickly.",
        },
      ],
      modes: [
        {
          value: "cursor-cli",
          meaning: "Run Cursor CLI agents with browser automation.",
        },
        {
          value: "copilot-cli",
          meaning: "Run Copilot CLI agents with browser automation.",
        },
        {
          value: "custom-cli",
          meaning: "Run another CLI agent command with the same artifact contract.",
        },
      ],
      chromeModes: [
        {
          value: "axi",
          meaning: "Use AXI browser automation.",
        },
        {
          value: "devtools-mcp",
          meaning: "Use the DevTools MCP browser automation mode.",
        },
      ],
      models: getConfiguredModelOptions(defaults),
      agentPersonas: (defaults?.agentPersonaOptions ?? []).map((persona) => ({
        value: persona.id,
        label: persona.label,
        instructions: persona.instructions,
        allowDestructiveActions: persona.allowDestructiveActions,
      })),
    },
    scenarioExamples: [
      {
        path: "/billing",
        goal: "Verify plan summary, invoice history, loading/empty/error states, and permission boundaries for non-admin users.",
      },
      {
        path: "/settings/team",
        goal: "Invite a teammate, validate form errors, refresh persistence, role changes, and audit for console/network failures.",
      },
    ],
  }
}

function formatClipboardConfig(
  formState: FormState,
  defaults: DefaultsResponse | null
) {
  return JSON.stringify(
    {
      config: getShareableConfig(formState),
      configurationGuide: getConfigurationGuide(defaults),
    },
    null,
    2
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getConfigObjectFromJson(rawConfig: string) {
  const parsed: unknown = JSON.parse(rawConfig)
  if (!isRecord(parsed)) {
    throw new Error("Config must be a JSON object.")
  }

  const config = isRecord(parsed.config) ? parsed.config : parsed
  if (!isRecord(config)) {
    throw new Error("config must be a JSON object.")
  }

  return config
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function normalizeStringArray(value: unknown, fallback: Array<string>) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : fallback
}

function normalizeRoutes(value: unknown, fallback: Array<RouteInput>) {
  if (!Array.isArray(value)) return fallback

  const routes = value
    .filter(isRecord)
    .map((route) => ({
      path: normalizeString(route.path, ""),
      goal: normalizeString(route.goal, ""),
    }))
    .filter((route) => route.path || route.goal)

  return routes.length > 0 ? routes : fallback
}

function mergeConfigObject(
  config: Record<string, unknown>,
  previous: FormState
): FormState {
  return {
    ...previous,
    baseUrl: normalizeString(config.baseUrl, previous.baseUrl),
    appName: normalizeString(config.appName, previous.appName),
    routes: normalizeRoutes(config.routes, previous.routes),
    instructions: normalizeString(config.instructions, previous.instructions),
    agents: normalizeNumber(config.agents, previous.agents),
    agentConcurrency: normalizeString(
      config.agentConcurrency,
      previous.agentConcurrency
    ),
    agentConcurrencyManual: normalizeBoolean(
      config.agentConcurrencyManual,
      previous.agentConcurrencyManual
    ),
    assignmentStrategy: normalizeString(
      config.assignmentStrategy,
      previous.assignmentStrategy
    ),
    agentPersonas: normalizeStringArray(
      config.agentPersonas,
      previous.agentPersonas
    ),
    agentDirectives: normalizeString(
      config.agentDirectives,
      previous.agentDirectives
    ),
    mode: normalizeString(config.mode, previous.mode),
    chromeMode: normalizeString(config.chromeMode, previous.chromeMode),
    model: normalizeString(config.model, previous.model),
    agentCommand: normalizeString(
      config.agentCommand ?? config.cursorCommand,
      previous.agentCommand
    ),
    cursorCommand: normalizeString(
      config.cursorCommand,
      previous.cursorCommand
    ),
    maxRouteSteps: normalizeNumber(
      config.maxRouteSteps,
      previous.maxRouteSteps
    ),
    axiPortBase: normalizeString(config.axiPortBase, previous.axiPortBase),
    noDevServer: normalizeBoolean(config.noDevServer, previous.noDevServer),
  }
}

function isIntegerInRange(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max
}

function isAllowedOption(value: string, options: Array<string>) {
  return options.includes(value)
}

function defaultCommandForMode(mode: string) {
  switch (mode) {
    case "cursor-cli":
      return "agent"
    case "copilot-cli":
      return "copilot"
    case "custom-cli":
      return "agent"
    default:
      return "agent"
  }
}

function provisionalDefaultsForMode(
  mode: string,
  command: string,
  previous: DefaultsResponse | null
): DefaultsResponse | null {
  if (!previous) {
    return previous
  }
  const models = fallbackModelsForMode(mode)
  return {
    ...previous,
    mode,
    model: models[0]?.id ?? "auto",
    models,
    modelSource: "fallback",
    modelError: undefined,
    agentCommand: command,
    cursorCommand: command,
  }
}

function validateRawConfig(
  config: Record<string, unknown>,
  merged: FormState,
  defaults: DefaultsResponse | null
) {
  const errors: Array<string> = []
  const modelOptions = getConfiguredModelOptions(defaults).map(
    (model) => model.value
  )
  const personaOptions = (defaults?.agentPersonaOptions ?? []).map(
    (persona) => persona.id
  )

  if ("secrets" in config) {
    errors.push(
      "secrets is not supported in JSON config; use the Credentials section."
    )
  }
  if ("baseUrl" in config && typeof config.baseUrl !== "string") {
    errors.push("baseUrl must be a string.")
  }
  if ("appName" in config && typeof config.appName !== "string") {
    errors.push("appName must be a string.")
  }
  if ("instructions" in config && typeof config.instructions !== "string") {
    errors.push("instructions must be a string.")
  }
  if (
    "agents" in config &&
    (typeof config.agents !== "number" || !Number.isFinite(config.agents))
  ) {
    errors.push("agents must be a number.")
  }
  if (
    "agentConcurrency" in config &&
    typeof config.agentConcurrency !== "string"
  ) {
    errors.push('agentConcurrency must be a string, for example "auto" or "4".')
  }
  if (
    "agentConcurrencyManual" in config &&
    typeof config.agentConcurrencyManual !== "boolean"
  ) {
    errors.push("agentConcurrencyManual must be true or false.")
  }
  if (
    "assignmentStrategy" in config &&
    typeof config.assignmentStrategy !== "string"
  ) {
    errors.push("assignmentStrategy must be a string.")
  }
  if (
    "agentDirectives" in config &&
    typeof config.agentDirectives !== "string"
  ) {
    errors.push("agentDirectives must be a string.")
  }
  if ("mode" in config && typeof config.mode !== "string") {
    errors.push("mode must be a string.")
  }
  if ("chromeMode" in config && typeof config.chromeMode !== "string") {
    errors.push("chromeMode must be a string.")
  }
  if ("model" in config && typeof config.model !== "string") {
    errors.push("model must be a string.")
  }
  if ("agentCommand" in config && typeof config.agentCommand !== "string") {
    errors.push("agentCommand must be a string.")
  }
  if ("cursorCommand" in config && typeof config.cursorCommand !== "string") {
    errors.push("cursorCommand must be a string.")
  }
  if (
    "maxRouteSteps" in config &&
    (typeof config.maxRouteSteps !== "number" ||
      !Number.isFinite(config.maxRouteSteps))
  ) {
    errors.push("maxRouteSteps must be a number.")
  }
  if ("axiPortBase" in config && typeof config.axiPortBase !== "string") {
    errors.push('axiPortBase must be a string, for example "" or "9333".')
  }
  if ("noDevServer" in config && typeof config.noDevServer !== "boolean") {
    errors.push("noDevServer must be true or false.")
  }

  if (typeof merged.baseUrl !== "string" || !merged.baseUrl.trim()) {
    errors.push("baseUrl is required.")
  } else {
    try {
      const url = new URL(merged.baseUrl)
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push("baseUrl must use http:// or https://.")
      }
    } catch {
      errors.push(
        "baseUrl must be a valid URL, for example http://localhost:3000."
      )
    }
  }

  if (typeof merged.appName !== "string" || !merged.appName.trim()) {
    errors.push("appName is required.")
  }

  if (!Array.isArray(config.routes) && "routes" in config) {
    errors.push("routes must be an array of { path, goal } objects.")
  }
  if (Array.isArray(config.routes)) {
    config.routes.forEach((route, index) => {
      if (!isRecord(route)) {
        errors.push(`routes[${index}] must be an object.`)
        return
      }
      if (typeof route.path !== "string") {
        errors.push(`routes[${index}].path must be a string.`)
      }
      if (typeof route.goal !== "string") {
        errors.push(`routes[${index}].goal must be a string.`)
      }
    })
  }
  if (merged.routes.length === 0) {
    errors.push("routes must include at least one scenario.")
  }
  merged.routes.forEach((route, index) => {
    if (!route.path.trim()) {
      errors.push(`routes[${index}].path is required.`)
    } else if (!route.path.startsWith("/")) {
      errors.push(`routes[${index}].path must start with "/".`)
    }
    if (!route.goal.trim()) {
      errors.push(`routes[${index}].goal is required.`)
    }
  })

  if (!isIntegerInRange(merged.agents, 1, 1000)) {
    errors.push("agents must be an integer between 1 and 1000.")
  }

  if (
    merged.agentConcurrency !== "auto" &&
    !isIntegerInRange(Number(merged.agentConcurrency), 1, 1000)
  ) {
    errors.push(
      'agentConcurrency must be "auto" or an integer string from 1 to 1000.'
    )
  }

  if (typeof merged.agentConcurrencyManual !== "boolean") {
    errors.push("agentConcurrencyManual must be true or false.")
  }

  if (!isAllowedOption(merged.assignmentStrategy, assignmentStrategyOptions)) {
    errors.push(
      `assignmentStrategy must be one of: ${assignmentStrategyOptions.join(", ")}.`
    )
  }

  if (!Array.isArray(config.agentPersonas) && "agentPersonas" in config) {
    errors.push("agentPersonas must be an array of persona IDs.")
  }
  if (personaOptions.length > 0) {
    const unknownPersonas = merged.agentPersonas.filter(
      (persona) => !personaOptions.includes(persona)
    )
    if (unknownPersonas.length > 0) {
      errors.push(
        `agentPersonas contains unknown IDs: ${unknownPersonas.join(", ")}.`
      )
    }
  }

  if (typeof merged.agentDirectives !== "string") {
    errors.push("agentDirectives must be a string.")
  }

  if (!isAllowedOption(merged.mode, modeOptions)) {
    errors.push(`mode must be one of: ${modeOptions.join(", ")}.`)
  }

  if (!isAllowedOption(merged.chromeMode, chromeModeOptions)) {
    errors.push(`chromeMode must be one of: ${chromeModeOptions.join(", ")}.`)
  }

  if (modelOptions.length > 0 && !modelOptions.includes(merged.model)) {
    errors.push(`model must be one of: ${modelOptions.join(", ")}.`)
  }

  if (
    typeof merged.agentCommand !== "string" ||
    !merged.agentCommand.trim()
  ) {
    errors.push("agentCommand is required.")
  }

  if (!isIntegerInRange(merged.maxRouteSteps, 1, 100)) {
    errors.push("maxRouteSteps must be an integer between 1 and 100.")
  }

  if (
    merged.axiPortBase.trim() &&
    !isIntegerInRange(Number(merged.axiPortBase), 1, 65535)
  ) {
    errors.push(
      "axiPortBase must be empty or an integer string from 1 to 65535."
    )
  }

  if (typeof merged.noDevServer !== "boolean") {
    errors.push("noDevServer must be true or false.")
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"))
  }
}

function validateAndMergeConfigJson(
  rawConfig: string,
  previous: FormState,
  defaults: DefaultsResponse | null
) {
  const config = getConfigObjectFromJson(rawConfig)
  const merged = mergeConfigObject(config, previous)
  validateRawConfig(config, merged, defaults)
  return merged
}

export function ConfigForm({
  defaults,
  isRunning,
  onSubmit,
  onCancel,
}: ConfigFormProps) {
  const [modelDefaults, setModelDefaults] = useState<DefaultsResponse | null>(defaults)
  const [formState, setFormState] = useState<FormState>(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem("cursor-browser-swarm.ui.form")
        : null
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<FormState>
        const mode =
          parsed.mode && modeOptions.includes(parsed.mode) ? parsed.mode : "cursor-cli"
        const command =
          parsed.agentCommand ?? parsed.cursorCommand ?? defaultCommandForMode(mode)
        return {
          ...parsed,
          mode,
          chromeMode: parsed.chromeMode === "devtools-mcp" ? "devtools-mcp" : "axi",
          agentCommand: command,
          cursorCommand: command,
        } as FormState
      } catch {}
    }
    return {
      baseUrl: "http://localhost:3000",
      appName: "My App",
      routes: [
        {
          path: "/dashboard",
          goal: "Click dashboard cards, filters, empty states, and navigation links.",
        },
      ],
      instructions: defaultInstructions,
      secrets: [],
      agents: 4,
      agentConcurrency: "auto",
      agentConcurrencyManual: false,
      assignmentStrategy: "replicate",
      agentPersonas: [],
      agentDirectives: "",
      mode: "cursor-cli",
      chromeMode: "axi",
      model: "composer-2-fast",
      agentCommand: "agent",
      cursorCommand: "agent",
      maxRouteSteps: 12,
      axiPortBase: "",
      noDevServer: true,
    }
  })
  const [isEditingJson, setIsEditingJson] = useState(false)
  const [rawConfig, setRawConfig] = useState(() => formatConfig(formState))

  useEffect(() => {
    setModelDefaults(defaults)
  }, [defaults])

  useEffect(() => {
    if (defaults && !localStorage.getItem("cursor-browser-swarm.ui.form")) {
      setFormState((prev) => ({
        ...prev,
        baseUrl: defaults.baseUrl,
        appName: defaults.appName,
        agents: defaults.agents,
        agentConcurrency: defaults.agentConcurrency,
        assignmentStrategy: defaults.assignmentStrategy,
        agentPersonas: defaults.agentPersonas.split(",").filter(Boolean),
        mode: defaults.mode,
        chromeMode: defaults.chromeMode,
        model: defaults.model,
        agentCommand: defaults.agentCommand,
        cursorCommand: defaults.cursorCommand,
        maxRouteSteps: defaults.maxRouteSteps,
      }))
    }
  }, [defaults])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams({
        mode: formState.mode,
        agentCommand: formState.agentCommand,
      })
      void fetch(`/api/defaults?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Defaults request failed with ${response.status}`)
          }
          return response.json() as Promise<DefaultsResponse>
        })
        .then((nextDefaults) => {
          setModelDefaults(nextDefaults)
          const nextModel = nextDefaults.models.some((model) => model.id === formState.model)
            ? formState.model
            : nextDefaults.model
          setFormState((prev) => ({
            ...prev,
            model: nextModel,
          }))
        })
        .catch((error) => {
          if (error instanceof Error && error.name === "AbortError") {
            return
          }
          toast.error("Failed to refresh models for selected CLI")
        })
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [formState.agentCommand, formState.mode, formState.model])

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "cursor-browser-swarm.ui.form",
        JSON.stringify(formState)
      )
    }
  }, [formState])

  useEffect(() => {
    if (!isEditingJson) {
      setRawConfig(formatConfig(formState))
    }
  }, [formState, isEditingJson])

  const updateField = useCallback(
    <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) => {
      setFormState((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const addRoute = useCallback(() => {
    setFormState((prev) => ({
      ...prev,
      routes: [...prev.routes, { path: "", goal: "" }],
    }))
  }, [])

  const updateRoute = useCallback(
    (index: number, field: keyof RouteInput, value: string) => {
      setFormState((prev) => ({
        ...prev,
        routes: prev.routes.map((r, i) =>
          i === index ? { ...r, [field]: value } : r
        ),
      }))
    },
    []
  )

  const removeRoute = useCallback((index: number) => {
    setFormState((prev) => ({
      ...prev,
      routes: prev.routes.filter((_, i) => i !== index),
    }))
  }, [])

  const addSecret = useCallback(() => {
    setFormState((prev) => ({
      ...prev,
      secrets: [...prev.secrets, { key: "", value: "" }],
    }))
  }, [])

  const updateSecret = useCallback(
    (index: number, field: keyof SecretInput, value: string) => {
      setFormState((prev) => ({
        ...prev,
        secrets: prev.secrets.map((s, i) =>
          i === index ? { ...s, [field]: value } : s
        ),
      }))
    },
    []
  )

  const removeSecret = useCallback((index: number) => {
    setFormState((prev) => ({
      ...prev,
      secrets: prev.secrets.filter((_, i) => i !== index),
    }))
  }, [])

  const togglePersona = useCallback((id: string) => {
    setFormState((prev) => ({
      ...prev,
      agentPersonas: prev.agentPersonas.includes(id)
        ? prev.agentPersonas.filter((p) => p !== id)
        : [...prev.agentPersonas, id],
    }))
  }, [])

  const activeDefaults = modelDefaults ?? defaults

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isEditingJson) {
      onSubmit(formState)
      return
    }

    try {
      const nextState = validateAndMergeConfigJson(
        rawConfig,
        formState,
        activeDefaults
      )
      setFormState(nextState)
      onSubmit(nextState)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Config must be valid JSON"
      )
    }
  }

  const copyConfig = useCallback(async () => {
    try {
      const configToCopy = isEditingJson
        ? validateAndMergeConfigJson(rawConfig, formState, activeDefaults)
        : formState
      await navigator.clipboard.writeText(
        formatClipboardConfig(configToCopy, activeDefaults)
      )
      toast.success("Copied config")
    } catch {
      toast.error("Failed to copy config")
    }
  }, [activeDefaults, formState, isEditingJson, rawConfig])

  const toggleJsonEditor = useCallback(() => {
    setRawConfig(formatConfig(formState))
    setIsEditingJson((prev) => !prev)
  }, [formState])

  const applyRawConfig = useCallback(() => {
    try {
      const nextState = validateAndMergeConfigJson(
        rawConfig,
        formState,
        activeDefaults
      )
      setFormState(nextState)
      setIsEditingJson(false)
      toast.success("Applied config")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Config must be valid JSON"
      )
    }
  }, [activeDefaults, formState, rawConfig])

  const previewState = useMemo(() => {
    if (!isEditingJson) return formState

    try {
      return validateAndMergeConfigJson(rawConfig, formState, activeDefaults)
    } catch {
      return formState
    }
  }, [activeDefaults, formState, isEditingJson, rawConfig])

  const rawConfigErrors = useMemo(() => {
    if (!isEditingJson) return []

    try {
      validateAndMergeConfigJson(rawConfig, formState, activeDefaults)
      return []
    } catch (error) {
      return error instanceof Error
        ? error.message.split("\n").filter(Boolean)
        : ["Config must be valid JSON"]
    }
  }, [activeDefaults, formState, isEditingJson, rawConfig])

  const activeAgents =
    previewState.assignmentStrategy === "split"
      ? Math.min(previewState.agents, Math.max(previewState.routes.length, 1))
      : previewState.agents
  const isReduced = activeAgents < previewState.agents

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyConfig}
          disabled={isEditingJson && rawConfigErrors.length > 0}
        >
          <Copy className="mr-1.5 size-3.5" />
          Copy config
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggleJsonEditor}
        >
          <SlidersHorizontal className="mr-1.5 size-3.5" />
          {isEditingJson ? "Use form" : "Edit JSON"}
        </Button>
      </div>

      {isEditingJson && (
        <Card>
          <CardHeader>
            <CardTitle>Raw Config</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={rawConfig}
              onChange={(e) => setRawConfig(e.target.value)}
              className="min-h-96 font-mono text-xs"
              spellCheck={false}
            />
            {rawConfigErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium">
                    Fix config JSON before applying:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {rawConfigErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Secrets are intentionally excluded from copied config and left
                unchanged when JSON is applied.
              </p>
              <Button
                type="button"
                onClick={applyRawConfig}
                disabled={rawConfigErrors.length > 0}
              >
                Apply config
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isEditingJson && (
        <>
          {/* Target Section */}
          <Card>
            <CardHeader>
              <CardTitle>Target</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  value={formState.baseUrl}
                  onChange={(e) => updateField("baseUrl", e.target.value)}
                  placeholder="http://localhost:3000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appName">App name</Label>
                <Input
                  id="appName"
                  value={formState.appName}
                  onChange={(e) => updateField("appName", e.target.value)}
                  placeholder="My App"
                  required
                />
              </div>
            </CardContent>
          </Card>

          {/* Scenarios Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Scenarios</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRoute}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add route
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {formState.routes.map((route, index) => (
                <div
                  key={index}
                  className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]"
                >
                  <Input
                    value={route.path}
                    onChange={(e) => updateRoute(index, "path", e.target.value)}
                    placeholder="/path"
                    required
                  />
                  <Input
                    value={route.goal}
                    onChange={(e) => updateRoute(index, "goal", e.target.value)}
                    placeholder="Goal description"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeRoute(index)}
                    disabled={formState.routes.length <= 1}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Instructions Section */}
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={formState.instructions}
                onChange={(e) => updateField("instructions", e.target.value)}
                placeholder="Instructions for the agents..."
                rows={4}
              />
            </CardContent>
          </Card>

          {/* Credentials Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Credentials</CardTitle>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Values passed to agent processes, redacted from output
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSecret}
              >
                <Plus className="mr-1.5 size-3.5" />
                Add secret
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {formState.secrets.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  No secrets configured
                </p>
              )}
              {formState.secrets.map((secret, index) => (
                <div
                  key={index}
                  className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]"
                >
                  <Input
                    value={secret.key}
                    onChange={(e) => updateSecret(index, "key", e.target.value)}
                    placeholder="KEY"
                  />
                  <Input
                    type="password"
                    value={secret.value}
                    onChange={(e) =>
                      updateSecret(index, "value", e.target.value)
                    }
                    placeholder="Value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeSecret(index)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Run Controls Section */}
          <Card>
            <CardHeader>
              <CardTitle>Run Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="agents">Agents</Label>
                  <Input
                    id="agents"
                    type="number"
                    min={1}
                    max={1000}
                    value={formState.agents}
                    onChange={(e) =>
                      updateField("agents", parseInt(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentConcurrency">Agent concurrency</Label>
                  <Input
                    id="agentConcurrency"
                    value={formState.agentConcurrency}
                    onChange={(e) => {
                      updateField("agentConcurrency", e.target.value)
                      updateField("agentConcurrencyManual", true)
                    }}
                    placeholder="auto or 1-1000"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assignmentStrategy">Assignment</Label>
                  <Select
                    value={formState.assignmentStrategy}
                    onValueChange={(v) => updateField("assignmentStrategy", v)}
                  >
                    <SelectTrigger id="assignmentStrategy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replicate">
                        replicate routes per agent
                      </SelectItem>
                      <SelectItem value="split">
                        split routes across agents
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Agent personas</Label>
                  <PersonaSelector
                    options={defaults?.agentPersonaOptions ?? []}
                    selected={formState.agentPersonas}
                    onToggle={togglePersona}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mode">Mode</Label>
                  <Select
                    value={formState.mode}
                    onValueChange={(v) => {
                      const command = defaultCommandForMode(v)
                      setModelDefaults((prev) => provisionalDefaultsForMode(v, command, prev))
                      setFormState((prev) => ({
                        ...prev,
                        mode: v,
                        chromeMode: "axi",
                        model: fallbackModelForMode(v),
                        agentCommand: command,
                        cursorCommand: command,
                      }))
                    }}
                  >
                    <SelectTrigger id="mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cursor-cli">
                        Cursor CLI + AXI
                      </SelectItem>
                      <SelectItem value="copilot-cli">
                        Copilot CLI + AXI
                      </SelectItem>
                      <SelectItem value="custom-cli">Custom CLI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="chromeMode">Chrome mode</Label>
                  <Select
                    value={formState.chromeMode}
                    onValueChange={(v) => updateField("chromeMode", v)}
                  >
                    <SelectTrigger id="chromeMode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="axi">axi</SelectItem>
                      <SelectItem value="devtools-mcp">devtools-mcp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Select
                    value={formState.model}
                    onValueChange={(v) => updateField("model", v)}
                  >
                    <SelectTrigger id="model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        activeDefaults?.models ?? fallbackModelsForMode(formState.mode)
                      ).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id} - {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentCommand">Agent command</Label>
                  <Input
                    id="agentCommand"
                    value={formState.agentCommand}
                    onChange={(e) => {
                      updateField("agentCommand", e.target.value)
                      updateField("cursorCommand", e.target.value)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxRouteSteps">Max route steps</Label>
                  <Input
                    id="maxRouteSteps"
                    type="number"
                    min={1}
                    max={100}
                    value={formState.maxRouteSteps}
                    onChange={(e) =>
                      updateField(
                        "maxRouteSteps",
                        parseInt(e.target.value) || 12
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="axiPortBase">AXI port base</Label>
                  <Input
                    id="axiPortBase"
                    value={formState.axiPortBase}
                    onChange={(e) => updateField("axiPortBase", e.target.value)}
                    placeholder="auto"
                  />
                </div>
              </div>

              {/* Run Preview */}
              <Alert
                variant={isReduced ? "destructive" : "default"}
                className="bg-muted/50"
              >
                <AlertDescription>
                  {isReduced ? (
                    <>
                      Only {activeAgents} of {previewState.agents} requested
                      agents will run because split mode cannot create more
                      active agents than routes. Switch assignment to replicate
                      to run all agents.
                    </>
                  ) : (
                    <>
                      {activeAgents} active agents planned across{" "}
                      {previewState.routes.length} route(s); concurrency:{" "}
                      {previewState.agentConcurrency}.
                    </>
                  )}
                </AlertDescription>
              </Alert>

              {/* Custom Directives */}
              <div className="space-y-2">
                <Label htmlFor="agentDirectives">Custom directives</Label>
                <Textarea
                  id="agentDirectives"
                  value={formState.agentDirectives}
                  onChange={(e) =>
                    updateField("agentDirectives", e.target.value)
                  }
                  placeholder="vuln=Probe auth bypasses and ID tampering&#10;dates=Stress date edges, reloads, and persistence"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Built-in personas are assigned round-robin. Custom directives
                  use one ID=INSTRUCTIONS per line.
                </p>
              </div>

              {/* Dev Server Checkbox */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="noDevServer"
                  checked={formState.noDevServer}
                  onCheckedChange={(checked) =>
                    updateField("noDevServer", checked === true)
                  }
                />
                <Label htmlFor="noDevServer" className="font-normal">
                  I already started the dev server
                </Label>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Submit Buttons */}
      <div className="flex gap-3">
        <Button
          type="submit"
          className="flex-1"
          disabled={
            isRunning ||
            isReduced ||
            (isEditingJson && rawConfigErrors.length > 0)
          }
        >
          <Play className="mr-2 size-4" />
          Start swarm run
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!isRunning}
          onClick={onCancel}
        >
          <Square className="mr-2 size-4" />
          Cancel
        </Button>
      </div>
    </form>
  )
}

interface PersonaSelectorProps {
  options: Array<AgentPersonaOption>
  selected: Array<string>
  onToggle: (id: string) => void
}

function PersonaSelector({
  options,
  selected,
  onToggle,
}: PersonaSelectorProps) {
  const selectedLabels = options
    .filter((o) => selected.includes(o.id))
    .map((o) => o.label)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selectedLabels.length === 0
              ? "Select personas"
              : selectedLabels.length <= 2
                ? selectedLabels.join(", ")
                : `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <ScrollArea className="h-72">
          <div className="space-y-1 p-2">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                className="flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-accent"
              >
                <Checkbox
                  checked={selected.includes(option.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {option.instructions}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
