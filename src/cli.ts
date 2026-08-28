import { readFile } from "node:fs/promises";
import { composeBundle, writeIndexAtomic } from "./index";

async function main() {
  const [command, input, rootFlag, root, outputFlag, output] = process.argv.slice(2);
  if (command !== "compose" || !input || rootFlag !== "--root" || !root || outputFlag !== "--output" || !output) throw new Error("INVALID_REQUEST");
  const bundle = JSON.parse(await readFile(input, "utf8"));
  const index = await composeBundle(bundle, root);
  await writeIndexAtomic(output, index, root);
  console.log(JSON.stringify(index));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "UNKNOWN_ERROR"); process.exitCode = 1; });
