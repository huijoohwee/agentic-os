#!/usr/bin/env node
// Responsibility: Print one read-only goal advance; never dispatch or mutate.

import { readBoundedFile } from "../../src/catalog-input.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GOAL_RECEIPT_SCHEMA, planGoalAdvance } from "./goal-completion-runtime-contract.mjs";

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
    || null;
}

async function run() {
  const input = option("input");
  if (process.argv[2] !== "plan" || !input) {
    console.error("Usage: goal-completion-runtime.mjs plan --input=<goal.json> [--json]");
    process.exit(2);
  }
  const receipt = planGoalAdvance(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readBoundedFile(path.resolve(input), 128_000, "goal input"))));
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    const { progress: p } = receipt;
    console.log(
      `goal ${receipt.goalId}: ${receipt.state} `
      + `(${p.completedPermille / 10}% terminal; ${p.ready} ready, `
      + `${p.waiting} waiting, ${p.blocked} blocked)`,
    );
    if (receipt.nextUnitIds.length > 0) console.log(`next: ${receipt.nextUnitIds.join(", ")}`);
    console.log(`action: ${receipt.nextAction.id}`);
    if (receipt.nextAction.unitIds.length) console.log(`advance now: ${receipt.nextAction.unitIds.join(", ")}`);
    for (const [label, units] of [["waiting", receipt.waitingUnits], ["blocked", receipt.blockedUnits]]) {
      for (const unit of units) {
        console.log(`${label} ${unit.unitId}: ${unit.reason}`);
        if (unit.externalWait) console.log(`recheck ${unit.externalWait.dependencyId}: ${unit.externalWait.recheckTrigger}`);
      }
    }
  }
  // Blocked peers never fail the run while any ready unit remains.
  if (!receipt.continuable && receipt.state !== "complete") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (GOAL_RECEIPT_SCHEMA) await run();
}
