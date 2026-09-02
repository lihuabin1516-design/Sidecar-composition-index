# Workflow Adapter Contract Notes

## Stability rules

- `ccpanes.workflow.bundle.v1` is caller-owned input.
- `ccpanes.workflow.index.v1` is an advisory projection.
- Relative paths are normalized to `/` in output.
- The implementation validates the bytes it reads, not merely the declared digest.
- Optional-source absence is represented by `partial`; malformed optional content is an error.
- `projectGlobalWorkflow` consumes sanitized evidence only; it has no execution,
  network, shell, MCP, Coordinator, Worker, Session, or write-back behavior.

## Global workflow projection contract

The package entry re-exports the pure function:

```ts
projectGlobalWorkflow(input: GlobalWorkflowInput): GlobalWorkflowProjection
```

Input and output schemas:

```text
ccpanes.workflow.global-input.v1
ccpanes.workflow.global-projection.v1
```

The context chain is exactly three generations, in this order:

```text
context.md       -> current
context.prev.md  -> previous
context.prev2.md -> previous2
```

Each context item and each evidence layer retains:

```text
source
observedAt
status
authority
```

Context items additionally retain `role` and `digest`. Bootstrap retains
`state`; inventory retains availability and runtime version; preflight retains
readiness; runtime retains workflow and session evidence. Sidecar evidence is
always explicitly marked `advisoryOnly: true` and has advisory authority.

Authority labels are:

```text
canonical | observed | advisory | historical | unverified
```

Gate priority and `nextGate` values are:

```text
MCP_DISCOVERY -> PREFLIGHT -> WORKFLOW -> COMPLETE
```

The projection is fail-closed. Any `UNVERIFIED`, `DEGRADED`, or `BLOCKED`
context or inventory evidence blocks at `MCP_DISCOVERY`. Historical context or
inventory evidence also blocks at `MCP_DISCOVERY`. Historical bootstrap or
preflight evidence blocks at `PREFLIGHT`; historical runtime evidence blocks at
`WORKFLOW`. Historical evidence is display/audit material only and never
satisfies a current ready gate. The official current runtime observed target is
CC-Panes `0.12.9`; `0.12.3` is retained only as historical fixture/schema
baseline.

Malformed or insufficient input fails closed. Strings must use the controlled
sanitized formats required by the projection. Secret-like values, bearer/API
credentials, Authorization values, URL endpoints, host/port values, raw
session identifiers, PII, absolute project paths, and unknown nested fields are
rejected before projection. Rejected values are never copied into output.

## Integration order

```text
hooks evidence / sidecar artifacts
        -> workflow bundle
        -> ccpanes-workflow-adapter
        -> workflow index
        -> ccpanes-acceptance-pack
```

The adapter has no write-back channel to any upstream component.
