import test from "node:test";
import assert from "node:assert/strict";
import { projectGlobalWorkflow, type EvidenceStatus, type GlobalWorkflowInput } from "../src/globalWorkflowIndex";
import { projectGlobalWorkflow as projectFromPackage } from "../src/index";

const source = (name: string, status: EvidenceStatus, observedAt = "2026-08-31T12:00:00Z") => ({
  source: `fixture:${name}`,
  observedAt,
  status,
});

function fullInput(): GlobalWorkflowInput {
  return {
    schema: "ccpanes.workflow.global-input.v1",
    contextChain: [
      { ...source("context.md", "VERIFIED"), role: "current", path: "context.md", digest: "sha256:" + "1".repeat(64) },
      { ...source("context.prev.md", "VERIFIED"), role: "previous", path: "context.prev.md", digest: "sha256:" + "2".repeat(64) },
      { ...source("context.prev2.md", "VERIFIED"), role: "previous2", path: "context.prev2.md", digest: "sha256:" + "3".repeat(64) },
    ],
    bootstrap: { ...source("bootstrap", "VERIFIED"), state: "ACTIVE" },
    inventory: { ...source("mcp-inventory", "VERIFIED"), availability: "PRESENT", runtimeVersion: "0.12.9" },
    preflight: { ...source("preflight", "VERIFIED"), readiness: "READY" },
    runtime: { ...source("runtime", "VERIFIED"), workflow: "OBSERVED", sessionEvidence: true },
    advisory: { ...source("sidecar", "VERIFIED"), advisoryOnly: true },
  };
}

test("composes the complete offline projection and preserves source timestamps", () => {
  const projection = projectGlobalWorkflow(fullInput());

  assert.equal(projection.status, "ready");
  assert.equal(projection.nextGate, "COMPLETE");
  assert.equal(projection.runtimeTarget, "0.12.9");
  assert.equal(projection.evidence.inventory.runtimeVersion, "0.12.9");
  assert.deepEqual(projection.authorityLabels, ["canonical", "observed", "advisory", "historical", "unverified"]);
  assert.deepEqual((projection.contextChain as Array<{ role: string }>).map((item) => item.role), ["current", "previous", "previous2"]);
  assert.equal(projection.evidence.inventory.source, "fixture:mcp-inventory");
  assert.equal(projection.evidence.inventory.observedAt, "2026-08-31T12:00:00Z");
  assert.equal(projection.evidence.advisory.authority, "advisory");
});

test("keeps absent or unverified inventory blocked at MCP discovery", () => {
  for (const availability of ["ABSENT", "UNVERIFIED"] as const) {
    const input = fullInput();
    input.inventory = { ...source("mcp-inventory", availability === "UNVERIFIED" ? "UNVERIFIED" : "VERIFIED"), availability };
    const projection = projectGlobalWorkflow(input);
    assert.equal(projection.status, "blocked");
    assert.equal(projection.nextGate, "MCP_DISCOVERY");
  }
});

test("keeps degraded or blocked preflight blocked at PREFLIGHT", () => {
  for (const status of ["DEGRADED", "BLOCKED"] as const) {
    const input = fullInput();
    input.preflight = { ...source("preflight", status), readiness: "NOT_READY" };
    const projection = projectGlobalWorkflow(input);
    assert.equal(projection.status, "blocked");
    assert.equal(projection.nextGate, "PREFLIGHT");
  }
});

test("does not upgrade without workflow and session evidence", () => {
  const input = fullInput();
  input.runtime = { ...source("runtime", "VERIFIED"), workflow: "UNKNOWN", sessionEvidence: false };
  const projection = projectGlobalWorkflow(input);
  assert.equal(projection.status, "blocked");
  assert.equal(projection.nextGate, "WORKFLOW");
});

test("advisory sidecar evidence never becomes canonical readiness", () => {
  const input = fullInput();
  input.runtime = { ...source("runtime", "UNVERIFIED"), workflow: "UNKNOWN", sessionEvidence: false };
  input.advisory = { ...source("sidecar", "VERIFIED"), advisoryOnly: true };
  const projection = projectGlobalWorkflow(input);
  assert.equal(projection.status, "blocked");
  assert.equal(projection.nextGate, "WORKFLOW");
  assert.equal(projection.evidence.advisory.authority, "advisory");
});

test("historical evidence does not cover current unverified evidence", () => {
  const input = fullInput();
  input.inventory = { ...source("historical-inventory", "VERIFIED", "2026-08-20T12:00:00Z"), availability: "PRESENT", runtimeVersion: "0.12.9", authority: "historical" };
  input.preflight = { ...source("current-preflight", "UNVERIFIED"), readiness: "UNKNOWN" };
  const projection = projectGlobalWorkflow(input);
  assert.equal(projection.status, "blocked");
  assert.equal(projection.nextGate, "MCP_DISCOVERY");
  assert.equal(projection.runtimeTarget, null);
});

test("unverified authority blocks the corresponding gate even with verified status", () => {
  for (const index of [0, 1, 2] as const) {
    const input = fullInput();
    input.contextChain[index].authority = "unverified";
    const projection = projectGlobalWorkflow(input);
    assert.equal(projection.status, "blocked", `context ${index}`);
    assert.equal(projection.nextGate, "MCP_DISCOVERY", `context ${index}`);
  }
  for (const layer of ["inventory", "bootstrap", "preflight", "runtime"] as const) {
    const input = fullInput();
    input[layer].authority = "unverified";
    const projection = projectGlobalWorkflow(input);
    assert.equal(projection.status, "blocked", layer);
    assert.equal(projection.nextGate, layer === "inventory" ? "MCP_DISCOVERY" : layer === "runtime" ? "WORKFLOW" : "PREFLIGHT", layer);
    if (layer === "inventory") assert.equal(projection.runtimeTarget, null);
  }
});

test("rejects impossible observedAt calendar and clock values", () => {
  for (const observedAt of [
    "2026-99-99T99:99:99Z",
    "2026-02-30T12:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:60:00Z",
  ]) {
    const input = fullInput();
    input.runtime.observedAt = observedAt;
    assert.throws(() => projectGlobalWorkflow(input), /INVALID_GLOBAL_INPUT/, observedAt);
  }
});

test("accepts valid observedAt values with and without milliseconds", () => {
  const input = fullInput();
  input.runtime.observedAt = "2026-02-28T12:00:00.000Z";
  assert.equal(projectGlobalWorkflow(input).status, "ready");
  input.runtime.observedAt = "2026-02-28T12:00:00Z";
  assert.equal(projectGlobalWorkflow(input).status, "ready");
});

test("historical 0.12.3 inventory cannot satisfy the current 0.12.9 runtime gate", () => {
  const input = fullInput();
  input.inventory = {
    ...source("historical-inventory", "VERIFIED", "2026-08-20T12:00:00Z"),
    availability: "PRESENT",
    runtimeVersion: "0.12.3",
    authority: "historical",
  };
  const projection = projectGlobalWorkflow(input);
  assert.equal(projection.status, "blocked");
  assert.equal(projection.nextGate, "MCP_DISCOVERY");
  assert.equal(projection.evidence.inventory.runtimeVersion, "0.12.3");
  assert.equal(projection.runtimeTarget, null);
});

test("fails closed for missing, malformed, or sensitive input", () => {
  assert.throws(() => projectGlobalWorkflow({} as GlobalWorkflowInput), /INVALID_GLOBAL_INPUT/);
  const malformed = fullInput();
  malformed.contextChain = malformed.contextChain.slice(0, 2) as unknown as GlobalWorkflowInput["contextChain"];
  assert.throws(() => projectGlobalWorkflow(malformed), /INVALID_GLOBAL_INPUT/);
  const sensitive = fullInput();
  (sensitive.runtime as unknown as Record<string, unknown>).TOKEN = "secret";
  assert.throws(() => projectGlobalWorkflow(sensitive), /SENSITIVE_INPUT/);
});

test("recursively excludes sensitive output fields", () => {
  const projection = projectGlobalWorkflow(fullInput());
  const serialized = JSON.stringify(projection).toLowerCase();
  for (const key of ["token", "authorization", "endpoint", "port", "sessionid", "pii", "raw"]) {
    assert.equal(serialized.includes(key), false, `sensitive key leaked: ${key}`);
  }
});

test("blocks every context generation status and reports its audit fields", () => {
  for (const status of ["UNVERIFIED", "DEGRADED", "BLOCKED"] as const) {
    const input = fullInput();
    input.contextChain[0].status = status;
    const projection = projectGlobalWorkflow(input);
    assert.equal(projection.status, "blocked");
    assert.equal(projection.nextGate, "MCP_DISCOVERY");
    const context = projection.contextChain[0] as typeof projection.contextChain[0] & { status: string; authority: string };
    assert.equal(context.status, status);
    assert.equal(context.authority, "unverified");
  }
  const input = fullInput();
  input.contextChain[1].status = "BLOCKED";
  const projection = projectGlobalWorkflow(input);
  assert.equal(projection.status, "blocked");
  assert.equal(projection.nextGate, "MCP_DISCOVERY");
  assert.equal((projection.contextChain[1] as typeof projection.contextChain[1] & { status: string }).status, "BLOCKED");
});

test("historical authority never satisfies a current gate", () => {
  for (const layer of ["bootstrap", "inventory", "preflight", "runtime"] as const) {
    const input = fullInput();
    input[layer].authority = "historical";
    const projection = projectGlobalWorkflow(input);
    assert.equal(projection.status, "blocked", layer);
    assert.equal(projection.nextGate, layer === "inventory" ? "MCP_DISCOVERY" : layer === "runtime" ? "WORKFLOW" : "PREFLIGHT", layer);
  }
  const contextInput = fullInput();
  contextInput.contextChain[2].authority = "historical";
  const contextProjection = projectGlobalWorkflow(contextInput);
  assert.equal(contextProjection.status, "blocked");
  assert.equal(contextProjection.nextGate, "MCP_DISCOVERY");
});

test("rejects sensitive values in source and ordinary nested strings", () => {
  for (const value of [
    "Bearer SECRET_TOKEN",
    "api_key=SECRET",
    "Authorization: Basic SECRET",
    "https://host.example:8443/live",
    "session-0123456789",
    "person@example.com",
    "D:\\Users\\person\\project\\file.json",
  ]) {
    const input = fullInput();
    input.runtime.source = value;
    assert.throws(() => projectGlobalWorkflow(input), /SENSITIVE_INPUT/);
  }
  const input = fullInput() as GlobalWorkflowInput & { nested?: { note: string } };
  input.nested = { note: "nested bearer SECRET_TOKEN" };
  assert.throws(() => projectGlobalWorkflow(input), /SENSITIVE_INPUT/);
});

test("fails closed for plain secret-like strings and emits no projection", () => {
  for (const value of ["SECRET_TOKEN", "private secret"]) {
    const input = fullInput();
    input.runtime.source = value;
    let output: unknown;
    assert.throws(() => output = projectGlobalWorkflow(input), /SENSITIVE_INPUT/);
    assert.equal(output, undefined);
  }
  const nested = fullInput() as GlobalWorkflowInput & { note?: string };
  nested.note = "ordinary nested credential text";
  let output: unknown;
  assert.throws(() => output = projectGlobalWorkflow(nested), /SENSITIVE_INPUT/);
  assert.equal(output, undefined);
  assert.match(projectGlobalWorkflow(fullInput()).evidence.runtime.source, /^fixture:/);
});

test("rejects sensitive fixture source identifiers without returning a projection", () => {
  for (const source of [
    "fixture:api-key",
    "fixture:authorization",
    "fixture:endpoint",
    "fixture:host:port",
    "fixture:session-0123456789",
  ]) {
    const input = fullInput();
    input.runtime.source = source;
    let output: unknown;
    assert.throws(() => output = projectGlobalWorkflow(input), /SENSITIVE_INPUT/);
    assert.equal(output, undefined, source);
  }
});

test("keeps historical and unverified advisory evidence fail-closed with original authority", () => {
  for (const authority of ["historical", "unverified"] as const) {
    const input = fullInput();
    input.advisory.authority = authority;
    const projection = projectGlobalWorkflow(input);
    assert.notEqual(projection.status, "ready", authority);
    assert.notEqual(projection.nextGate, "COMPLETE", authority);
    assert.equal(projection.evidence.advisory.advisoryOnly, true);
    assert.equal(projection.evidence.advisory.source, "fixture:sidecar");
    assert.equal(projection.evidence.advisory.observedAt, "2026-08-31T12:00:00Z");
    assert.equal(projection.evidence.advisory.inputAuthority, authority);
  }
});

test("package entry exports the projection and preserves complete audit fields", () => {
  const input = fullInput();
  input.bootstrap.state = "COMPLETED";
  input.bootstrap.authority = "observed";
  input.advisory.authority = "advisory";
  const projection = projectFromPackage(input);
  const bootstrap = projection.evidence.bootstrap as typeof projection.evidence.bootstrap & { state: string };
  assert.equal(bootstrap.state, "COMPLETED");
  assert.equal(projection.evidence.bootstrap.status, "VERIFIED");
  assert.equal(projection.evidence.bootstrap.source, "fixture:bootstrap");
  assert.equal(projection.evidence.bootstrap.observedAt, "2026-08-31T12:00:00Z");
  assert.equal(projection.evidence.bootstrap.authority, "observed");
  assert.equal(projection.evidence.advisory.advisoryOnly, true);
  assert.equal(projection.evidence.advisory.source, "fixture:sidecar");
  assert.equal(projection.evidence.advisory.observedAt, "2026-08-31T12:00:00Z");
  const contextChain = projection.contextChain as Array<{ role: string; status: string; authority: string; source: string; observedAt: string }>;
  assert.deepEqual(contextChain.map((item) => ({
    role: item.role,
    status: item.status,
    authority: item.authority,
    source: item.source,
    observedAt: item.observedAt,
  })), [
    { role: "current", status: "VERIFIED", authority: "observed", source: "fixture:context.md", observedAt: "2026-08-31T12:00:00Z" },
    { role: "previous", status: "VERIFIED", authority: "observed", source: "fixture:context.prev.md", observedAt: "2026-08-31T12:00:00Z" },
    { role: "previous2", status: "VERIFIED", authority: "observed", source: "fixture:context.prev2.md", observedAt: "2026-08-31T12:00:00Z" },
  ]);
});
