import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

interface ArtifactRef { path: string; sha256: string }
export interface Bundle {
  schema: "ccpanes.workflow.bundle.v1";
  taskId: string;
  runId: string;
  outputSummary?: ArtifactRef;
  observability?: ArtifactRef;
  experience?: ArtifactRef;
}

export interface WorkflowIndex {
  schema: "ccpanes.workflow.index.v1";
  generatedAt: string;
  status: "ready" | "partial" | "blocked" | "unknown";
  taskId: string;
  runId: string;
  links: { outputSummary: string | null; observability: string | null; experienceCandidate: string | null };
  artifacts: Array<{ kind: "output-summary" | "observability-report" | "experience-candidate"; path: string; sha256: string }>;
  advisoryOnly: true;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const digest = /^sha256:[0-9a-f]{64}$/;

export const sha256 = (value: Buffer | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function targetPath(root: string, value: string): string {
  if (!value || isAbsolute(value) || value.split(/[\\/]+/).includes("..")) throw new Error("PATH_OUTSIDE_ROOT");
  const base = resolve(root);
  const target = resolve(base, value);
  const relation = relative(base, target);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("PATH_OUTSIDE_ROOT");
  return target;
}

function validateBundle(bundle: Bundle): void {
  if (!bundle || bundle.schema !== "ccpanes.workflow.bundle.v1" || !id.test(bundle.taskId) || !id.test(bundle.runId)) throw new Error("INVALID_BUNDLE");
  for (const ref of [bundle.outputSummary, bundle.observability, bundle.experience]) {
    if (ref && (!ref.path || !digest.test(ref.sha256))) throw new Error("INVALID_BUNDLE");
  }
  if (!bundle.outputSummary && !bundle.observability && !bundle.experience) throw new Error("INVALID_BUNDLE");
}

function parseArtifact(kind: WorkflowIndex["artifacts"][number]["kind"], value: unknown): { id: string; taskId: string; runId?: string } {
  const item = value as Record<string, unknown>;
  if (kind === "output-summary") {
    if (item.artifactType !== "output-summary" || typeof item.summaryId !== "string" || typeof item.taskId !== "string" || typeof item.runId !== "string") throw new Error("INVALID_ARTIFACT");
    return { id: item.summaryId, taskId: item.taskId, runId: item.runId };
  }
  if (kind === "observability-report") {
    if (item.schema !== "ccpanes.observability.report.v1" || typeof item.reportId !== "string") throw new Error("INVALID_ARTIFACT");
    return { id: item.reportId, taskId: item.reportId.replace(/^observability-/, "") };
  }
  if (item.artifactType !== "experience-candidate" || typeof item.candidateId !== "string" || typeof item.taskId !== "string" || item.status !== "candidate") throw new Error("INVALID_ARTIFACT");
  return { id: item.candidateId, taskId: item.taskId };
}

export async function composeBundle(bundle: Bundle, root: string, generatedAt = new Date().toISOString()): Promise<WorkflowIndex> {
  validateBundle(bundle);
  const links = { outputSummary: null as string | null, observability: null as string | null, experienceCandidate: null as string | null };
  const artifacts: WorkflowIndex["artifacts"] = [];
  const refs: Array<[keyof typeof links, "output-summary" | "observability-report" | "experience-candidate", ArtifactRef | undefined]> = [
    ["outputSummary", "output-summary", bundle.outputSummary],
    ["observability", "observability-report", bundle.observability],
    ["experienceCandidate", "experience-candidate", bundle.experience]
  ];
  for (const [key, kind, ref] of refs) {
    if (!ref) continue;
    const absolute = targetPath(root, ref.path);
    let bytes: Buffer;
    try { bytes = await readFile(absolute); } catch { if (key === "experienceCandidate") continue; throw new Error("SOURCE_MISSING"); }
    const actual = sha256(bytes);
    if (actual !== ref.sha256) throw new Error("SOURCE_DIGEST_MISMATCH");
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("INVALID_ARTIFACT"); }
    const identity = parseArtifact(kind, parsed);
    if (identity.taskId !== bundle.taskId || (identity.runId && identity.runId !== bundle.runId)) throw new Error("IDENTITY_CONFLICT");
    links[key] = identity.id;
    artifacts.push({ kind, path: ref.path.replace(/\\/g, "/"), sha256: actual });
  }
  const status = links.outputSummary && links.observability && links.experienceCandidate ? "ready" : "partial";
  return { schema: "ccpanes.workflow.index.v1", generatedAt, status, taskId: bundle.taskId, runId: bundle.runId, links, artifacts, advisoryOnly: true };
}

export function validateIndex(value: unknown): value is WorkflowIndex {
  const index = value as WorkflowIndex;
  return Boolean(index && index.schema === "ccpanes.workflow.index.v1" && typeof index.generatedAt === "string" && ["ready", "partial", "blocked", "unknown"].includes(index.status) && id.test(index.taskId) && id.test(index.runId) && index.links && Object.values(index.links).every(value => value === null || typeof value === "string") && Array.isArray(index.artifacts) && index.artifacts.every(item => digest.test(item.sha256) && typeof item.path === "string") && index.advisoryOnly === true);
}

export async function writeIndexAtomic(output: string, index: WorkflowIndex, root: string): Promise<void> {
  if (!validateIndex(index)) throw new Error("INVALID_INDEX");
  const target = targetPath(root, relative(resolve(root), resolve(output)));
  await mkdir(dirname(target), { recursive: true });
  const body = `${JSON.stringify(index, null, 2)}\n`;
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, body, "utf8");
  await rename(temp, target);
  if (!validateIndex(JSON.parse(await readFile(target, "utf8")))) throw new Error("RESULT_WRITE_FAILED");
}
