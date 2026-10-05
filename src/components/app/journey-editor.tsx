import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import {
  validateJourneyReferences,
  type ExtractionRule,
  type JourneyAssertion,
  type JourneyMethod,
  type JourneyStepDraft,
} from "@/lib/journey-domain";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type JourneyEditorStep = {
  id?: string;
  name: string;
  method: JourneyMethod;
  pathTemplate: string;
  requestHeaders: string;
  requestBody: string;
  extractionRules: ExtractionRule[];
  continueOnFailure: boolean;
  isCleanup: boolean;
  assertions: Array<JourneyAssertion & { expectedText: string }>;
};

export type JourneyEditorValue = {
  id?: string;
  name: string;
  description: string;
  integrationId: string;
  timeoutMs: number;
  active: boolean;
  capabilityIds: string[];
  steps: JourneyEditorStep[];
};

export type JourneyOption = { id: string; name: string };

const stages = ["Basics", "Steps", "Extraction", "Assertions", "Cleanup", "Review"] as const;
const methods: JourneyMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const assertionTypes: JourneyAssertion["assertion_type"][] = [
  "http_status",
  "json_path_equals",
  "json_path_exists",
  "json_path_type",
  "header_exists",
  "max_latency_ms",
];

export function JourneyEditor({
  open,
  initialValue,
  capabilities,
  integrations,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialValue: JourneyEditorValue;
  capabilities: JourneyOption[];
  integrations: JourneyOption[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: JourneyEditorValue, steps: JourneyStepDraft[]) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");

  const parsedSteps = useMemo(() => {
    try {
      return { steps: parseSteps(value.steps), errors: [] as string[] };
    } catch (parseError) {
      return {
        steps: [] as JourneyStepDraft[],
        errors: [parseError instanceof Error ? parseError.message : String(parseError)],
      };
    }
  }, [value.steps]);
  const referenceErrors = parsedSteps.errors.length
    ? parsedSteps.errors
    : validateJourneyReferences(parsedSteps.steps, ["credential", "archetype"]);
  const deleteWarnings = value.steps.filter(
    (step) => step.method === "DELETE" && !step.isCleanup,
  ).length;

  function next() {
    const stageError = validateStage(stage, value, parsedSteps.errors);
    if (stageError) {
      setError(stageError);
      return;
    }
    setError("");
    setStage((current) => Math.min(stages.length - 1, current + 1));
  }

  function updateStep(index: number, update: Partial<JourneyEditorStep>) {
    setValue((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...update } : step,
      ),
    }));
  }

  function addStep(isCleanup: boolean) {
    setValue((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          name: isCleanup ? "Delete resource" : "New step",
          method: isCleanup ? "DELETE" : "GET",
          pathTemplate: isCleanup ? "/resources/{{resource_id}}" : "/resources",
          requestHeaders: "{}",
          requestBody: "",
          extractionRules: [],
          continueOnFailure: false,
          isCleanup,
          assertions: [],
        },
      ],
    }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{value.id ? "Edit journey" : "New journey"}</DialogTitle>
        </DialogHeader>

        <ol className="grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label="Journey editor progress">
          {stages.map((label, index) => (
            <li
              key={label}
              className={`rounded px-2 py-1.5 text-center text-xs ${
                index === stage
                  ? "bg-primary text-primary-foreground"
                  : index < stage
                    ? "bg-muted font-medium"
                    : "text-muted-foreground"
              }`}
              aria-current={index === stage ? "step" : undefined}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <div className="min-h-80 py-2">
          {stage === 0 && (
            <BasicsStage
              value={value}
              capabilities={capabilities}
              integrations={integrations}
              onChange={setValue}
            />
          )}
          {stage === 1 && (
            <StepStage
              steps={value.steps}
              cleanup={false}
              onUpdate={updateStep}
              onDelete={(index) =>
                setValue({ ...value, steps: value.steps.filter((_, item) => item !== index) })
              }
              onAdd={() => addStep(false)}
            />
          )}
          {stage === 2 && <ExtractionStage steps={value.steps} onUpdate={updateStep} />}
          {stage === 3 && <AssertionStage steps={value.steps} onUpdate={updateStep} />}
          {stage === 4 && (
            <StepStage
              steps={value.steps}
              cleanup
              onUpdate={updateStep}
              onDelete={(index) =>
                setValue({ ...value, steps: value.steps.filter((_, item) => item !== index) })
              }
              onAdd={() => addStep(true)}
            />
          )}
          {stage === 5 && (
            <ReviewStage
              value={value}
              referenceErrors={referenceErrors}
              deleteWarnings={deleteWarnings}
              capabilities={capabilities}
              integrations={integrations}
            />
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <div>
            {stage > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setError("");
                  setStage((current) => current - 1);
                }}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            )}
          </div>
          {stage < stages.length - 1 ? (
            <Button type="button" onClick={next}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={saving || referenceErrors.length > 0}
              onClick={() => onSave(value, parsedSteps.steps)}
            >
              {saving ? "Saving…" : "Save journey"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BasicsStage({
  value,
  capabilities,
  integrations,
  onChange,
}: {
  value: JourneyEditorValue;
  capabilities: JourneyOption[];
  integrations: JourneyOption[];
  onChange: (value: JourneyEditorValue) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Name the customer behavior this journey proves and choose the provider it calls.
      </p>
      <Field label="Name">
        <Input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="Create and schedule a candidate"
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider">
          <Select
            value={value.integrationId}
            onValueChange={(integrationId) => onChange({ ...value, integrationId })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {integrations.map((integration) => (
                <SelectItem key={integration.id} value={integration.id}>
                  {integration.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Total timeout (milliseconds)">
          <Input
            type="number"
            min={500}
            max={60_000}
            value={value.timeoutMs}
            onChange={(event) => onChange({ ...value, timeoutMs: Number(event.target.value) })}
          />
        </Field>
      </div>
      <Field label="Capabilities">
        <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
          {capabilities.map((capability) => (
            <label key={capability.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.capabilityIds.includes(capability.id)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    capabilityIds: checked
                      ? [...value.capabilityIds, capability.id]
                      : value.capabilityIds.filter((id) => id !== capability.id),
                  })
                }
              />
              {capability.name}
            </label>
          ))}
          {capabilities.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add capabilities in Settings before creating a journey.
            </p>
          )}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={value.active}
          onCheckedChange={(active) => onChange({ ...value, active })}
        />
        Active
      </label>
    </div>
  );
}

function StepStage({
  steps,
  cleanup,
  onUpdate,
  onDelete,
  onAdd,
}: {
  steps: JourneyEditorStep[];
  cleanup: boolean;
  onUpdate: (index: number, update: Partial<JourneyEditorStep>) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  const visible = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.isCleanup === cleanup);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{cleanup ? "Cleanup steps" : "Primary steps"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {cleanup
            ? "Cleanup always runs after a failure when variables are available. Use DELETE carefully."
            : "Steps run in order. Paths are relative to the selected provider base URL."}
        </p>
      </div>
      {visible.map(({ step, index }, order) => (
        <div key={step.id ?? `${cleanup}-${index}`} className="space-y-3 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              {cleanup ? "Cleanup" : "Step"} {order + 1}
            </p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove ${step.name || "step"}`}
              onClick={() => onDelete(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Field label="Step name">
            <Input
              value={step.name}
              onChange={(event) => onUpdate(index, { name: event.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
            <Field label="Method">
              <Select
                value={step.method}
                onValueChange={(method) => onUpdate(index, { method: method as JourneyMethod })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Path template">
              <Input
                className="font-mono"
                value={step.pathTemplate}
                onChange={(event) => onUpdate(index, { pathTemplate: event.target.value })}
                placeholder="/resources/{{resource_id}}"
              />
            </Field>
          </div>
          {step.method === "DELETE" && !cleanup && (
            <p className="flex gap-2 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              This destructive request runs before cleanup. Confirm that it is intentional.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Headers (JSON)">
              <Textarea
                className="min-h-24 font-mono text-xs"
                value={step.requestHeaders}
                onChange={(event) => onUpdate(index, { requestHeaders: event.target.value })}
              />
            </Field>
            <Field label="Body (JSON, optional)">
              <Textarea
                className="min-h-24 font-mono text-xs"
                value={step.requestBody}
                onChange={(event) => onUpdate(index, { requestBody: event.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={step.continueOnFailure}
              onCheckedChange={(checked) =>
                onUpdate(index, { continueOnFailure: Boolean(checked) })
              }
            />
            Continue after this step fails
          </label>
        </div>
      ))}
      {visible.length === 0 && (
        <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
          {cleanup ? "No cleanup is configured." : "Add at least one primary step."}
        </p>
      )}
      <Button type="button" variant="outline" onClick={onAdd}>
        <Plus className="h-4 w-4" /> Add {cleanup ? "cleanup step" : "step"}
      </Button>
    </div>
  );
}

function ExtractionStage({
  steps,
  onUpdate,
}: {
  steps: JourneyEditorStep[];
  onUpdate: (index: number, update: Partial<JourneyEditorStep>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Extract named values from a response for later steps. Names must be unique and are
        referenced as {"{{name}}"}.
      </p>
      {steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => !step.isCleanup)
        .map(({ step, index }) => (
          <div key={index} className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">{step.name}</p>
            {step.extractionRules.map((rule, ruleIndex) => (
              <div key={ruleIndex} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]">
                <Input
                  aria-label="Extraction name"
                  className="font-mono"
                  value={rule.name}
                  onChange={(event) =>
                    onUpdate(index, {
                      extractionRules: step.extractionRules.map((item, itemIndex) =>
                        itemIndex === ruleIndex ? { ...item, name: event.target.value } : item,
                      ),
                    })
                  }
                  placeholder="resource_id"
                />
                <Select
                  value={rule.source}
                  onValueChange={(source) =>
                    onUpdate(index, {
                      extractionRules: step.extractionRules.map((item, itemIndex) =>
                        itemIndex === ruleIndex
                          ? { ...item, source: source as ExtractionRule["source"] }
                          : item,
                      ),
                    })
                  }
                >
                  <SelectTrigger aria-label="Extraction source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="body">Body</SelectItem>
                    <SelectItem value="header">Header</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Extraction path"
                  className="font-mono"
                  value={rule.path}
                  onChange={(event) =>
                    onUpdate(index, {
                      extractionRules: step.extractionRules.map((item, itemIndex) =>
                        itemIndex === ruleIndex ? { ...item, path: event.target.value } : item,
                      ),
                    })
                  }
                  placeholder={rule.source === "body" ? "$.id" : "x-request-id"}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove extraction"
                  onClick={() =>
                    onUpdate(index, {
                      extractionRules: step.extractionRules.filter(
                        (_, itemIndex) => itemIndex !== ruleIndex,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onUpdate(index, {
                  extractionRules: [
                    ...step.extractionRules,
                    { name: "", source: "body", path: "$.id" },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" /> Add extraction
            </Button>
          </div>
        ))}
    </div>
  );
}

function AssertionStage({
  steps,
  onUpdate,
}: {
  steps: JourneyEditorStep[];
  onUpdate: (index: number, update: Partial<JourneyEditorStep>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Assertions decide whether a step passed. A journey without meaningful assertions cannot
        protect a release.
      </p>
      {steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => !step.isCleanup)
        .map(({ step, index }) => (
          <div key={index} className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">{step.name}</p>
            {step.assertions.map((assertion, assertionIndex) => (
              <div key={assertionIndex} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
                <Select
                  value={assertion.assertion_type}
                  onValueChange={(assertionType) =>
                    onUpdate(index, {
                      assertions: step.assertions.map((item, itemIndex) =>
                        itemIndex === assertionIndex
                          ? {
                              ...item,
                              assertion_type: assertionType as JourneyAssertion["assertion_type"],
                            }
                          : item,
                      ),
                    })
                  }
                >
                  <SelectTrigger aria-label="Assertion type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assertionTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Assertion target"
                  className="font-mono"
                  value={assertion.target ?? ""}
                  onChange={(event) =>
                    onUpdate(index, {
                      assertions: step.assertions.map((item, itemIndex) =>
                        itemIndex === assertionIndex
                          ? { ...item, target: event.target.value }
                          : item,
                      ),
                    })
                  }
                  placeholder="$.id or header"
                />
                <Input
                  aria-label="Expected value"
                  className="font-mono"
                  value={assertion.expectedText}
                  onChange={(event) =>
                    onUpdate(index, {
                      assertions: step.assertions.map((item, itemIndex) =>
                        itemIndex === assertionIndex
                          ? { ...item, expectedText: event.target.value }
                          : item,
                      ),
                    })
                  }
                  placeholder="201"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove assertion"
                  onClick={() =>
                    onUpdate(index, {
                      assertions: step.assertions.filter(
                        (_, itemIndex) => itemIndex !== assertionIndex,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onUpdate(index, {
                  assertions: [
                    ...step.assertions,
                    {
                      assertion_type: "http_status",
                      target: "",
                      operator: "eq",
                      expected_value: 200,
                      expectedText: "200",
                    },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" /> Add assertion
            </Button>
          </div>
        ))}
    </div>
  );
}

function ReviewStage({
  value,
  referenceErrors,
  deleteWarnings,
  capabilities,
  integrations,
}: {
  value: JourneyEditorValue;
  referenceErrors: string[];
  deleteWarnings: number;
  capabilities: JourneyOption[];
  integrations: JourneyOption[];
}) {
  const primary = value.steps.filter((step) => !step.isCleanup);
  const cleanup = value.steps.filter((step) => step.isCleanup);
  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <h3 className="font-medium">{value.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {integrations.find((item) => item.id === value.integrationId)?.name} · {value.timeoutMs}ms
          timeout
        </p>
        <p className="mt-3 text-sm">
          {primary.length} primary {primary.length === 1 ? "step" : "steps"} · {cleanup.length}{" "}
          cleanup {cleanup.length === 1 ? "step" : "steps"} ·{" "}
          {value.steps.reduce((total, step) => total + step.assertions.length, 0)} assertions
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {value.capabilityIds
            .map((id) => capabilities.find((item) => item.id === id)?.name)
            .filter(Boolean)
            .join(", ")}
        </p>
      </div>
      {deleteWarnings > 0 && (
        <p className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {deleteWarnings} DELETE request {deleteWarnings === 1 ? "is" : "are"} configured outside
          cleanup.
        </p>
      )}
      {referenceErrors.length > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">Fix these references before saving:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {referenceErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
          Templates, extraction order, and request JSON are valid.
        </p>
      )}
    </div>
  );
}

function parseSteps(steps: JourneyEditorStep[]): JourneyStepDraft[] {
  return steps.map((step) => ({
    name: z.string().trim().min(1, "Every step needs a name").max(120).parse(step.name),
    method: step.method,
    path_template: z
      .string()
      .startsWith("/", "Every step path must begin with /")
      .max(500)
      .parse(step.pathTemplate),
    request_headers: parseObject(step.requestHeaders, `${step.name} headers`),
    request_body: step.requestBody.trim() ? parseJson(step.requestBody, `${step.name} body`) : null,
    extraction_rules: step.extractionRules,
    continue_on_failure: step.continueOnFailure,
    is_cleanup: step.isCleanup,
    assertions: step.assertions.map(({ expectedText, ...assertion }) => ({
      ...assertion,
      expected_value: expectedText.trim() ? parseLooseJson(expectedText) : null,
    })),
  }));
}

function parseObject(value: string, label: string): Record<string, string> {
  const parsed = parseJson(value || "{}", label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, string>;
}

function parseJson(value: string, label: string): Json {
  try {
    return JSON.parse(value) as Json;
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

function parseLooseJson(value: string): Json {
  try {
    return JSON.parse(value) as Json;
  } catch {
    return value;
  }
}

function validateStage(stage: number, value: JourneyEditorValue, parseErrors: string[]): string {
  if (stage === 0) {
    if (value.name.trim().length < 2) return "Enter a journey name.";
    if (!value.integrationId) return "Select a provider.";
    if (!value.capabilityIds.length) return "Select at least one capability.";
    if (value.timeoutMs < 500 || value.timeoutMs > 60_000)
      return "Timeout must be between 500 and 60000 milliseconds.";
  }
  if (stage === 1 && !value.steps.some((step) => !step.isCleanup))
    return "Add at least one primary step.";
  if ((stage === 1 || stage === 4) && parseErrors.length)
    return parseErrors[0] ?? "A request value is invalid.";
  return "";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
