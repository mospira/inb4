import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  runVelocityReplay,
  VelocityReplayValidationError
} from "../src/shared/velocityReplay";

const inputPath = process.argv[2];

if (!inputPath) {
  process.stderr.write("Usage: npm run replay:velocity -- <trace.json>\n");
  process.exitCode = 1;
} else {
  try {
    const raw = await readFile(resolve(inputPath), "utf8");
    const result = runVelocityReplay(JSON.parse(raw) as unknown);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message =
      error instanceof VelocityReplayValidationError || error instanceof Error
        ? error.message
        : "Unexpected replay failure.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
