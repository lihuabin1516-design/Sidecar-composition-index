# Workflow Adapter Contract Notes

## Stability rules

- `ccpanes.workflow.bundle.v1` is caller-owned input.
- `ccpanes.workflow.index.v1` is an advisory projection.
- Relative paths are normalized to `/` in output.
- The implementation validates the bytes it reads, not merely the declared digest.
- Optional-source absence is represented by `partial`; malformed optional content is an error.

## Integration order

```text
hooks evidence / sidecar artifacts
        -> workflow bundle
        -> ccpanes-workflow-adapter
        -> workflow index
        -> ccpanes-acceptance-pack
```

The adapter has no write-back channel to any upstream component.
