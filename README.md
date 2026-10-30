# Sidecar Composition Index

`ccpanes-workflow-adapter` 是 CC-Panes Companion 的**只读 sidecar composition
index**。它把已经由各自权威组件生成的 output summary、observability report
和 experience candidate 通过受限路径、SHA-256 和身份一致性检查，组合成一个
可供审查、交接和 acceptance-pack 消费的稳定索引。

它不是 Coordinator、Hooks、Method Layer 或任何 sidecar 的替代品，也不执行
Workflow、Worker、Session 或权限决策。

## 设计目标

1. **只读投影**：不调用 CC-Panes MCP，不启动 Worker，不修改项目和用户配置。
2. **可重放**：相同输入文件与 digest 产生相同的 artifact links；时间字段由调用方
   可选注入，便于测试和审计。
3. **显式不完整性**：缺少可选 experience candidate 时输出 `partial`，缺少必需源、
   digest 漂移、JSON/身份冲突时直接失败。
4. **路径隔离**：所有引用必须是 root 内相对路径，拒绝绝对路径与 `..` 穿越。
5. **权威分层**：输出固定带 `advisoryOnly: true`，下游不得把它当作完成许可。

## 权威边界

| 能力 | 权威归属 | 本仓库行为 |
|---|---|---|
| 范围、权限、硬门禁、审计、completion gate | Hooks Governance Layer | 只消费其派生 artifact |
| task/run/evidence/handoff schema | Method Layer | 不定义、不覆盖方法层协议 |
| Pane/Session/PTY/Worker 状态 | 官方 CC-Panes | 完全不连接运行时 |
| output summary | `ccpanes-output-sidecar` | 校验并链接 |
| observability report | `ccpanes-observability-sidecar` | 校验并链接 |
| experience candidate | `ccpanes-experience-sidecar` | 可选校验并链接 |
| Workflow/Worker/Result 状态 | Codex Desktop Companion | 不读取 SQLite、不作状态推断 |

本项目绝不写入 Skill、Hooks、AGENTS.md、Method Layer schema、Codex/CC-Panes
全局配置、memory pool、远端仓库或用户项目。

## 输入与输出合同

输入 `ccpanes.workflow.bundle.v1`：

```json
{
  "schema": "ccpanes.workflow.bundle.v1",
  "taskId": "task-example",
  "runId": "run-example",
  "outputSummary": { "path": "fixtures/output.json", "sha256": "sha256:<64 hex>" },
  "observability": { "path": "fixtures/observability.json", "sha256": "sha256:<64 hex>" },
  "experience": { "path": "fixtures/candidate.json", "sha256": "sha256:<64 hex>" }
}
```

输出 `ccpanes.workflow.index.v1` 的关键字段：

- `status`: `ready`、`partial`、`blocked` 或 `unknown`；
- `links`: 各来源 artifact 的权威 ID；
- `artifacts`: 规范化相对路径和实际 SHA-256；
- `taskId`、`runId`：所有被接受 artifact 的身份必须一致；
- `advisoryOnly: true`：强制声明这是审查/交接索引而非完成判定。

## 状态与错误语义

- `ready`：三个 artifact 都存在、digest 正确、身份一致；
- `partial`：必需 artifact 成功，可选 experience candidate 缺失；
- `blocked`：保留给上游/下游组合层，不由当前 compose 路径伪造成功；
- `unknown`：保留给没有可靠状态来源的消费者；
- `SOURCE_MISSING`：必需源不存在；
- `SOURCE_DIGEST_MISMATCH`：文件内容与声明 digest 不一致；
- `PATH_OUTSIDE_ROOT`：引用越出输入 root；
- `INVALID_BUNDLE` / `INVALID_ARTIFACT`：schema 或 artifact 身份不合法；
- `IDENTITY_CONFLICT`：task/run 身份不一致；
- `RESULT_WRITE_FAILED`：原子写入后再次验证失败。

## 目录结构

```text
src/index.ts       核心类型、路径/digest/身份校验、compose、原子写入
src/cli.ts         compose CLI 入口
tests/             Node test runner 合同测试
fixtures/          不含密钥的合成 artifact
scripts/lint.cjs   轻量源码规范检查
```

## 安装、开发与验收

```powershell
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run smoke:production
```

直接生成索引：

```powershell
node dist/src/cli.js compose fixtures/bundle.json `
  --root . --output out/workflow-index.json
```

`out/`、`dist/` 和 `node_modules/` 仅为本地生成物，不属于交付 artifact。提交前
必须确认它们没有绕过 `.gitignore` 进入 Git。

## 安全与隐私

- 只接受 root 内相对路径；
- 不读取未声明的目录树；
- 不解析或保存 Session ID、Token、Prompt、终端输出和用户项目内容；
- 不使用网络、不调用 shell、不执行输入文件中的命令；
- digest 只用于完整性和链接校验，不代表文件内容本身已获得 Hooks 授权；
- 任何失败都以非零进程状态暴露，调用方应把它记录为失败而非继续发布。

## 版本与贡献

当前包版本为 `0.1.0`，schema 名称带版本后缀。破坏字段或语义时新增 schema
版本，不静默改变旧版本含义；兼容性增强应补充合同测试和 fixture。

贡献提交应说明：输入/输出合同变化、权威边界影响、隐私影响、测试命令和
是否需要同步 Acceptance Pack。禁止把执行逻辑、权限判断或运行时
Session 控制塞进本仓库。

## License

Original project materials are licensed under the MIT License; see [`LICENSE`](./LICENSE).
Third-party dependencies remain under their respective licenses. The npm package
is marked `private` and is not currently published to the npm registry.
