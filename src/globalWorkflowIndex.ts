export type EvidenceStatus = "VERIFIED" | "UNVERIFIED" | "DEGRADED" | "BLOCKED";
export type Authority = "canonical" | "observed" | "advisory" | "historical" | "unverified";
export type ContextRole = "current" | "previous" | "previous2";
export type NextGate = "MCP_DISCOVERY" | "PREFLIGHT" | "WORKFLOW" | "COMPLETE";

export interface EvidenceEnvelope {
  source: string;
  observedAt: string;
  status: EvidenceStatus;
  authority?: Authority;
}

export interface ContextEvidence extends EvidenceEnvelope {
  role: ContextRole;
  path: string;
  digest: string;
}

export interface GlobalWorkflowInput {
  schema: "ccpanes.workflow.global-input.v1";
  contextChain: [ContextEvidence, ContextEvidence, ContextEvidence];
  bootstrap: EvidenceEnvelope & { state: "CREATED" | "BOOTSTRAPPING" | "ACTIVE" | "COMPLETED" };
  inventory: EvidenceEnvelope & { availability: "PRESENT" | "ABSENT" | "UNVERIFIED"; runtimeVersion?: string };
  preflight: EvidenceEnvelope & { readiness: "READY" | "NOT_READY" | "UNKNOWN" };
  runtime: EvidenceEnvelope & { workflow: "OBSERVED" | "UNKNOWN"; sessionEvidence: boolean };
  advisory: EvidenceEnvelope & { advisoryOnly: true };
}

export interface ProjectedEvidence {
  source: string;
  observedAt: string;
  status: EvidenceStatus;
  authority: Authority;
}

export interface GlobalWorkflowProjection {
  schema: "ccpanes.workflow.global-projection.v1";
  status: "ready" | "blocked" | "unverified";
  nextGate: NextGate;
  runtimeTarget: "0.12.9" | null;
  authorityLabels: Authority[];
  contextChain: Array<{ role: ContextRole; status: EvidenceStatus; authority: Authority; source: string; observedAt: string; digest: string }>;
  evidence: {
    bootstrap: ProjectedEvidence & { state: GlobalWorkflowInput["bootstrap"]["state"] };
    inventory: ProjectedEvidence & { availability: GlobalWorkflowInput["inventory"]["availability"]; runtimeVersion?: string };
    preflight: ProjectedEvidence & { readiness: GlobalWorkflowInput["preflight"]["readiness"] };
    runtime: ProjectedEvidence & { workflow: GlobalWorkflowInput["runtime"]["workflow"]; sessionEvidence: boolean };
    advisory: ProjectedEvidence & { advisoryOnly: true; inputAuthority: Authority };
  };
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;
const SENSITIVE_KEY = /(token|authorization|endpoint|port|session.?id|pii|secret|credential|transcript|project.?content|argv|command|path.?content|raw)/i;
const SAFE_SOURCE = /^fixture:(?!.*(?:secret|token|credential|private|bearer|api[-_ ]?key|authorization|endpoint|host[:_-]?port|session[-_]))[a-z0-9][a-z0-9._:-]{0,95}$/i;
const SAFE_STRING = /^(?:ccpanes\.[a-z0-9.-]+\.v\d+|fixture:[a-z0-9._:-]+|context(?:\.prev2?)?\.md|sha256:[0-9a-f]{64}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z|0\.12\.(?:3|9)|VERIFIED|UNVERIFIED|DEGRADED|BLOCKED|CREATED|BOOTSTRAPPING|ACTIVE|COMPLETED|PRESENT|ABSENT|READY|NOT_READY|UNKNOWN|OBSERVED|current|previous|previous2|canonical|observed|advisory|historical|unverified|MCP_DISCOVERY|PREFLIGHT|WORKFLOW|COMPLETE)$/;
const AUTHORITY_LABELS: Authority[] = ["canonical", "observed", "advisory", "historical", "unverified"];
const ALLOWED_KEYS = new Set([
  "schema", "contextChain", "bootstrap", "inventory", "preflight", "runtime", "advisory",
  "source", "observedAt", "status", "authority", "role", "path", "digest", "state",
  "availability", "runtimeVersion", "readiness", "workflow", "sessionEvidence", "advisoryOnly",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidObservedAt(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function assertNoSensitiveData(value: unknown, key?: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoSensitiveData(item));
    return;
  }
  if (typeof value === "string" &&
    (!SAFE_STRING.test(value) || (key === "source" && !SAFE_SOURCE.test(value)))) {
    throw new Error("SENSITIVE_INPUT");
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || !ALLOWED_KEYS.has(key)) throw new Error("SENSITIVE_INPUT");
    assertNoSensitiveData(child, key);
  }
}

function assertEnvelope(value: unknown): asserts value is EvidenceEnvelope {
  if (!isRecord(value) || typeof value.source !== "string" || value.source.length === 0 ||
    typeof value.observedAt !== "string" || !isValidObservedAt(value.observedAt) ||
    !["VERIFIED", "UNVERIFIED", "DEGRADED", "BLOCKED"].includes(String(value.status)) ||
    (value.authority !== undefined && !AUTHORITY_LABELS.includes(value.authority as Authority))) {
    throw new Error("INVALID_GLOBAL_INPUT");
  }
}

function validateInput(input: GlobalWorkflowInput): void {
  assertNoSensitiveData(input);
  if (!isRecord(input) || input.schema !== "ccpanes.workflow.global-input.v1" ||
    !Array.isArray(input.contextChain) || input.contextChain.length !== 3) {
    throw new Error("INVALID_GLOBAL_INPUT");
  }
  const roles: ContextRole[] = ["current", "previous", "previous2"];
  input.contextChain.forEach((item, index) => {
    assertEnvelope(item);
    if (item.role !== roles[index] || typeof item.path !== "string" || item.path.length === 0 ||
      !DIGEST.test(item.digest) || item.path !== ["context.md", "context.prev.md", "context.prev2.md"][index]) {
      throw new Error("INVALID_GLOBAL_INPUT");
    }
  });
  assertEnvelope(input.bootstrap);
  if (!["CREATED", "BOOTSTRAPPING", "ACTIVE", "COMPLETED"].includes(input.bootstrap.state)) throw new Error("INVALID_GLOBAL_INPUT");
  assertEnvelope(input.inventory);
  if (!["PRESENT", "ABSENT", "UNVERIFIED"].includes(input.inventory.availability) ||
    (input.inventory.runtimeVersion !== undefined && typeof input.inventory.runtimeVersion !== "string")) throw new Error("INVALID_GLOBAL_INPUT");
  assertEnvelope(input.preflight);
  if (!["READY", "NOT_READY", "UNKNOWN"].includes(input.preflight.readiness)) throw new Error("INVALID_GLOBAL_INPUT");
  assertEnvelope(input.runtime);
  if (!["OBSERVED", "UNKNOWN"].includes(input.runtime.workflow) || typeof input.runtime.sessionEvidence !== "boolean") throw new Error("INVALID_GLOBAL_INPUT");
  assertEnvelope(input.advisory);
  if (input.advisory.advisoryOnly !== true) throw new Error("INVALID_GLOBAL_INPUT");
}

function authorityFor(item: EvidenceEnvelope, fallback: Authority): Authority {
  if (item.status !== "VERIFIED") return "unverified";
  return item.authority ?? fallback;
}

function projected(item: EvidenceEnvelope, fallback: Authority): ProjectedEvidence {
  return { source: item.source, observedAt: item.observedAt, status: item.status, authority: authorityFor(item, fallback) };
}

export function projectGlobalWorkflow(input: GlobalWorkflowInput): GlobalWorkflowProjection {
  validateInput(input);
  const inventory = projected(input.inventory, "observed");
  const preflight = projected(input.preflight, "canonical");
  const runtime = projected(input.runtime, "observed");
  const bootstrap = projected(input.bootstrap, "observed");
  const advisory = {
    ...projected(input.advisory, "advisory"),
    authority: "advisory" as const,
    inputAuthority: input.advisory.authority ?? "advisory",
  };
  const inventorySatisfiesCurrentRuntimeGate =
    input.inventory.status === "VERIFIED" &&
    input.inventory.authority !== "historical" &&
    input.inventory.authority !== "unverified" &&
    input.inventory.availability === "PRESENT" &&
    input.inventory.runtimeVersion === "0.12.9";

  let status: GlobalWorkflowProjection["status"] = "ready";
  let nextGate: NextGate = "COMPLETE";
  if (input.contextChain.some((item) => item.status !== "VERIFIED" || item.authority === "historical" || item.authority === "unverified") ||
    !inventorySatisfiesCurrentRuntimeGate) {
    status = "blocked"; nextGate = "MCP_DISCOVERY";
  } else if (input.preflight.status !== "VERIFIED" || input.preflight.authority === "unverified" || input.preflight.readiness !== "READY" ||
    input.preflight.authority === "historical" ||
    input.bootstrap.status !== "VERIFIED" || input.bootstrap.authority === "historical" || input.bootstrap.authority === "unverified" ||
    !["ACTIVE", "COMPLETED"].includes(input.bootstrap.state)) {
    status = "blocked"; nextGate = "PREFLIGHT";
  } else if (input.runtime.status !== "VERIFIED" || input.runtime.authority === "historical" || input.runtime.authority === "unverified" ||
    input.runtime.workflow !== "OBSERVED" || !input.runtime.sessionEvidence) {
    status = "blocked"; nextGate = "WORKFLOW";
  }
  if (input.advisory.status !== "VERIFIED" ||
    input.advisory.authority === "historical" ||
    input.advisory.authority === "unverified") {
    status = status === "ready" ? "unverified" : status;
    if (nextGate === "COMPLETE") nextGate = "WORKFLOW";
  }

  return {
    schema: "ccpanes.workflow.global-projection.v1",
    status,
    nextGate,
    runtimeTarget: inventorySatisfiesCurrentRuntimeGate ? "0.12.9" : null,
    authorityLabels: [...AUTHORITY_LABELS],
    contextChain: input.contextChain.map((item) => ({
      role: item.role,
      status: item.status,
      authority: authorityFor(item, "observed"),
      source: item.source,
      observedAt: item.observedAt,
      digest: item.digest,
    })),
    evidence: {
      bootstrap: { ...bootstrap, state: input.bootstrap.state },
      inventory: { ...inventory, availability: input.inventory.availability, ...(input.inventory.runtimeVersion ? { runtimeVersion: input.inventory.runtimeVersion } : {}) },
      preflight: { ...preflight, readiness: input.preflight.readiness },
      runtime: { ...runtime, workflow: input.runtime.workflow, sessionEvidence: input.runtime.sessionEvidence },
      advisory: { ...advisory, advisoryOnly: true },
    },
  };
}
