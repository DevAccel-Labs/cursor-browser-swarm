import { useState, useEffect, useCallback } from "react"
import { Plus, Trash2, ChevronDown, Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type {
  FormState,
  RouteInput,
  SecretInput,
  AgentPersonaOption,
  DefaultsResponse,
} from "@/lib/types"

interface ConfigFormProps {
  defaults: DefaultsResponse | null
  isRunning: boolean
  onSubmit: (state: FormState) => void
  onCancel: () => void
}

const defaultInstructions = `Use the test account credentials from env vars.
Focus on console errors, failed network requests, visual breakage, and repro steps.`

export function ConfigForm({ defaults, isRunning, onSubmit, onCancel }: ConfigFormProps) {
  const [formState, setFormState] = useState<FormState>(() => {
    const saved = typeof window !== "undefined" 
      ? localStorage.getItem("cursor-browser-swarm.ui.form") 
      : null
    if (saved) {
      try {
        return JSON.parse(saved) as FormState
      } catch {}
    }
    return {
      baseUrl: "http://localhost:3000",
      appName: "My App",
      routes: [{ path: "/dashboard", goal: "Click dashboard cards, filters, empty states, and navigation links." }],
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
      cursorCommand: "agent",
      maxRouteSteps: 12,
      axiPortBase: "",
      noDevServer: true,
    }
  })

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
        cursorCommand: defaults.cursorCommand,
        maxRouteSteps: defaults.maxRouteSteps,
      }))
    }
  }, [defaults])

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("cursor-browser-swarm.ui.form", JSON.stringify(formState))
    }
  }, [formState])

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormState((prev) => ({ ...prev, [key]: value }))
  }, [])

  const addRoute = useCallback(() => {
    setFormState((prev) => ({
      ...prev,
      routes: [...prev.routes, { path: "", goal: "" }],
    }))
  }, [])

  const updateRoute = useCallback((index: number, field: keyof RouteInput, value: string) => {
    setFormState((prev) => ({
      ...prev,
      routes: prev.routes.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    }))
  }, [])

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

  const updateSecret = useCallback((index: number, field: keyof SecretInput, value: string) => {
    setFormState((prev) => ({
      ...prev,
      secrets: prev.secrets.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }))
  }, [])

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formState)
  }

  const activeAgents = formState.assignmentStrategy === "split"
    ? Math.min(formState.agents, Math.max(formState.routes.length, 1))
    : formState.agents
  const isReduced = activeAgents < formState.agents

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Target Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Target</CardTitle>
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
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-base">Scenarios</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addRoute}>
            <Plus className="mr-1.5 size-3.5" />
            Add route
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {formState.routes.map((route, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
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
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Instructions</CardTitle>
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
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-base">Credentials</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Values are passed to agent processes and redacted from output
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addSecret}>
            <Plus className="mr-1.5 size-3.5" />
            Add secret
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {formState.secrets.length === 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">No secrets configured</p>
          )}
          {formState.secrets.map((secret, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
              <Input
                value={secret.key}
                onChange={(e) => updateSecret(index, "key", e.target.value)}
                placeholder="KEY"
              />
              <Input
                type="password"
                value={secret.value}
                onChange={(e) => updateSecret(index, "value", e.target.value)}
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
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Run Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="agents">Agents</Label>
              <Input
                id="agents"
                type="number"
                min={1}
                max={1000}
                value={formState.agents}
                onChange={(e) => updateField("agents", parseInt(e.target.value) || 1)}
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
                  <SelectItem value="replicate">replicate routes per agent</SelectItem>
                  <SelectItem value="split">split routes across agents</SelectItem>
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
              <Select value={formState.mode} onValueChange={(v) => updateField("mode", v)}>
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cursor-cli">Cursor CLI + AXI</SelectItem>
                  <SelectItem value="cursor-sdk">Cursor SDK</SelectItem>
                  <SelectItem value="cloud-api">Cloud API</SelectItem>
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
              <Select value={formState.model} onValueChange={(v) => updateField("model", v)}>
                <SelectTrigger id="model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(defaults?.models ?? [{ id: "composer-2-fast", name: "Composer 2 Fast" }]).map(
                    (m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.id} - {m.name}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cursorCommand">Cursor command</Label>
              <Input
                id="cursorCommand"
                value={formState.cursorCommand}
                onChange={(e) => updateField("cursorCommand", e.target.value)}
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
                onChange={(e) => updateField("maxRouteSteps", parseInt(e.target.value) || 12)}
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
          <Alert variant={isReduced ? "destructive" : "default"} className="bg-muted/50">
            <AlertDescription>
              {isReduced ? (
                <>
                  Only {activeAgents} of {formState.agents} requested agents will run because split
                  mode cannot create more active agents than routes. Switch assignment to replicate
                  to run all agents.
                </>
              ) : (
                <>
                  {activeAgents} active agents planned across {formState.routes.length} route(s);
                  concurrency: {formState.agentConcurrency}.
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
              onChange={(e) => updateField("agentDirectives", e.target.value)}
              placeholder="vuln=Probe auth bypasses and ID tampering&#10;dates=Stress date edges, reloads, and persistence"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Built-in personas are assigned round-robin. Custom directives use one ID=INSTRUCTIONS
              per line.
            </p>
          </div>

          {/* Dev Server Checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="noDevServer"
              checked={formState.noDevServer}
              onCheckedChange={(checked) => updateField("noDevServer", checked === true)}
            />
            <Label htmlFor="noDevServer" className="font-normal">
              I already started the dev server
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Submit Buttons */}
      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={isRunning || isReduced}>
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
  options: AgentPersonaOption[]
  selected: string[]
  onToggle: (id: string) => void
}

function PersonaSelector({ options, selected, onToggle }: PersonaSelectorProps) {
  const selectedLabels = options
    .filter((o) => selected.includes(o.id))
    .map((o) => o.label)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
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
                <Checkbox checked={selected.includes(option.id)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">{option.instructions}</div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
