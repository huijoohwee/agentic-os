import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCoordinationSchedule } from "../runtime/planning/coordination-scheduler-contract.mjs";

const digest = character => character.repeat(64);
const task = (id, overrides = {}) => ({
  id,
  priority: 0,
  dependencies: [],
  declaredWriteSet: [`path:${id}.mjs`, `semantic:${id}`],
  authorityState: "current",
  findings: [],
  ...overrides,
});
const input = tasks => ({ schema: "agentic-coordination-scheduler-input/v1", capacity: 2, tasks });

test("schedules disjoint current claims in one bounded wave", () => {
  const report = buildCoordinationSchedule(input([task("alpha"), task("beta")]));
  assert.deepEqual(report.waves[0].taskIds, ["alpha", "beta"]);
  assert.equal(report.summary.ready, 2);
  assert.equal(report.mutation, false);
  assert.match(report.reportDigest, /^[0-9a-f]{64}$/u);
});

test("keeps a waiting successor non-writing without blocking a disjoint task", () => {
  const report = buildCoordinationSchedule(input([
    task("queued", { authorityState: "waiting-successor" }),
    task("runnable"),
  ]));
  assert.deepEqual(report.ready.map(item => item.taskId), ["runnable"]);
  assert.deepEqual(report.waiting.map(item => item.taskId), ["queued"]);
});

const externalWait = () => ({
  dependencyId: "ci:repository/revision/42/1",
  condition: "The exact published revision passes its required checks.",
  observationDigest: digest("c"),
  recheckTrigger: "Provider completion event or the next independent implementation milestone.",
});

test("a waiting owner's reservation excludes overlaps and their dependents, not independent work", () => {
  for (const owner of [
    { authorityState: "waiting-successor" },
    { externalWait: externalWait() },
  ]) {
    const report = buildCoordinationSchedule(input([
      task("owner", { ...owner, declaredWriteSet: ["path:src/shared/"] }),
      task("overlap", { declaredWriteSet: ["path:src/shared/child.mjs"] }),
      task("dependent", { dependencies: ["overlap"] }),
      task("independent"),
    ]));
    assert.deepEqual(report.ready.map(item => item.taskId), ["independent"]);
    assert.equal(report.waiting.find(item => item.taskId === "overlap").reason, "write-set-reserved");
    assert.deepEqual(report.waiting.find(item => item.taskId === "overlap").related, ["owner"]);
    assert.equal(report.waiting.find(item => item.taskId === "dependent").reason, "dependency-waiting");
  }
});

test("explicit waits preserve bounded evidence and cannot override admission", () => {
  const wait = externalWait(), source = input([
    task("ci", { externalWait: wait }),
    task("child", { dependencies: ["ci"] }),
    task("free"),
  ]);
  const before = structuredClone(source), report = buildCoordinationSchedule(source);
  assert.deepEqual(source, before);
  assert.deepEqual(report.ready.map(item => item.taskId), ["free"]);
  assert.deepEqual(report.waiting.find(item => item.taskId === "ci").externalWait, wait);
  assert.ok(Object.isFrozen(report.waiting[0].externalWait));
  assert.notEqual(report.reportDigest, buildCoordinationSchedule(input([
    ...source.tasks.slice(0, 1).map(item => ({ ...item, externalWait: { ...wait, observationDigest: digest("d") } })),
    ...source.tasks.slice(1),
  ])).reportDigest);
  const refused = buildCoordinationSchedule(input([task("ci", { authorityState: "retired", externalWait: wait })]));
  assert.equal(refused.blocked[0].reason, "write-authority-unavailable");
  assert.equal(refused.ready.length, 0);
});

test("malformed or oversized wait records fail closed", () => {
  for (const wait of [null, {}, { ...externalWait(), extra: true },
    { ...externalWait(), observationDigest: "bad" }, { ...externalWait(), condition: "" },
    { ...externalWait(), recheckTrigger: "x".repeat(1025) }]) {
    assert.throws(() => buildCoordinationSchedule(input([task("ci", { externalWait: wait })])), /external wait/);
  }
});

test("wait evidence conforms to the published closed disposition schema", () => {
  const schema = JSON.parse(readFileSync(new URL("../runtime/planning/coordination-scheduler-report.v1.schema.json", import.meta.url), "utf8"));
  const report = buildCoordinationSchedule(input([task("ci", { externalWait: externalWait() }), task("free")]));
  const disposition = schema.$defs.disposition, wait = schema.$defs.externalWait;
  assert.equal(disposition.additionalProperties, false);
  assert.equal(disposition.properties.externalWait.$ref, "#/$defs/externalWait");
  for (const item of [...report.ready, ...report.waiting]) {
    assert.ok(Object.keys(item).every(key => Object.hasOwn(disposition.properties, key)));
    if (!item.externalWait) continue;
    assert.deepEqual(Object.keys(item.externalWait).sort(), [...wait.required].sort());
    for (const [key, value] of Object.entries(item.externalWait)) {
      const rule = wait.properties[key].$ref ? schema.$defs.digest : wait.properties[key];
      assert.equal(typeof value, rule.type);
      if (rule.pattern) assert.match(value, new RegExp(rule.pattern));
      else assert.ok(value.length >= rule.minLength && value.length <= rule.maxLength);
    }
  }
});

test("records proven disjoint global attention without blocking", () => {
  const report = buildCoordinationSchedule(input([task("candidate", {
    findings: [{
      code: "foreign-attention-required",
      blockScope: "global",
      affectedWriteSet: ["path:foreign.mjs", "semantic:foreign"],
      evidenceDigest: digest("a"),
    }],
  })]));
  assert.equal(report.summary.ready, 1);
  assert.equal(report.nonBlockingAttention.length, 1);
});

test("fails closed when global attention has no disjoint scope proof", () => {
  const report = buildCoordinationSchedule(input([task("candidate", {
    findings: [{ code: "unknown-owner", blockScope: "global", affectedWriteSet: null,
      evidenceDigest: digest("b") }],
  })]));
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.blocked[0].reason, "admission-finding");
});

test("serializes overlapping candidates and respects dependencies", () => {
  const shared = ["path:shared.mjs", "semantic:shared"];
  const report = buildCoordinationSchedule(input([
    task("first", { priority: 2, declaredWriteSet: shared }),
    task("second", { priority: 1, declaredWriteSet: shared }),
    task("child", { dependencies: ["first"] }),
  ]));
  assert.deepEqual(report.waves, [
    { index: 0, taskIds: ["first"] },
    { index: 1, taskIds: ["second", "child"] },
  ]);
});

test("rejects cyclic task graphs before scheduling", () => {
  assert.throws(() => buildCoordinationSchedule(input([
    task("alpha", { dependencies: ["beta"] }),
    task("beta", { dependencies: ["alpha"] }),
  ])), /dependency cycle/u);
});
