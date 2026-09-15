import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { createSkillProposerRuntime } from "../runtime/adapters/skill-proposer.js";
import { createSkillRegistryGate } from "../runtime/adapters/skill-registry-gate.js";
import { createInMemoryDraftStore, createOperatorInstructionResolver, createScriptedCandidateAdapter } from "./lib/native-skill-harness-fakes.mjs";
const ownerText = moduleName => readFile(fileURLToPath(import.meta.resolve(`agentic-os/agents/${moduleName}`)), "utf8");
const PROPERTY_SEED = 20260817;
function parseLocalImports(text) {
  return [...text.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map(match => match[1]);
}

test("the gate accepts no model-adapter-shaped and no fetch-shaped parameter", () => {
  for (const option of [
    { proposeCandidate: () => {} },
    { fetch: () => {} },
    { fetchImpl: () => {} },
    { modelAdapter: () => {} },
  ]) {
    assert.throws(() => createSkillRegistryGate(option), /unsupported fields/);
  }
  const gate = createSkillRegistryGate({
    draftStore: createInMemoryDraftStore(),
    resolveOperatorInstruction: createOperatorInstructionResolver({ resolvable: ["ref"] }).resolveOperatorInstruction,
  });
  assert.deepEqual(Object.keys(gate).sort(), ["boundaryState", "promote", "stats"]);
  assert.equal(gate.stats().modelCallCapability, false);
});

test("Property 14: Evaluator independence as a structural invariant", async () => {
  const proposerText = await ownerText("skill-proposer");
  const gateText = await ownerText("skill-registry-gate");
  const adapterRegistrationText = await ownerText("adapter-registration");
  const definitionsText = await ownerText("agent-definitions");
  const proposerImports = parseLocalImports(proposerText);
  const gateImports = parseLocalImports(gateText);
  const adapterRegistrationImports = parseLocalImports(adapterRegistrationText);
  const definitionsImports = parseLocalImports(definitionsText);

  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          useKnownDraftId: fc.boolean(),
          reference: fc.anything(),
        }),
        { minLength: 0, maxLength: 20 },
      ),
      async (promoteInputs) => {
        assert.equal(proposerImports.includes("./skill-registry-gate.js"), false);
        assert.equal(proposerImports.includes("./adapter-registration.js"), false);
        assert.equal(proposerImports.includes("./agent-definitions.js"), false);
        assert.equal(gateImports.includes("./skill-proposer.js"), false);
        assert.equal(gateImports.some((specifier) => /openai|model|provider/i.test(specifier)), false);
        assert.equal(definitionsImports.includes("./skill-proposer.js"), false);
        assert.equal(definitionsImports.includes("./skill-registry-gate.js"), false);
        assert.equal(definitionsImports.includes("./adapter-registration.js"), false);
        assert.equal(adapterRegistrationImports.includes("./skill-proposer.js"), false);

        const proposerRuntime = createSkillProposerRuntime({
          draftStore: createInMemoryDraftStore(),
          proposeCandidate: createScriptedCandidateAdapter(["valid"]).proposeCandidate,
        });
        assert.deepEqual(Object.keys(proposerRuntime).sort(), ["propose", "stats"]);

        const draftStore = createInMemoryDraftStore();
        const gate = createSkillRegistryGate({
          draftStore,
          resolveOperatorInstruction: createOperatorInstructionResolver({ resolvable: ["ref"] }).resolveOperatorInstruction,
        });
        const draftId = "fixture-draft";
        await draftStore.put({
          schema: "acos-skill-draft/v1",
          draft_id: draftId,
          status: "proposed",
          adapter_id: "agentic-graph",
          gap_signal_id: "gap-001",
          agent_definition: {
            id: "fixture-agent",
            revision: "fixture-v1",
            name: "Fixture Agent",
            source: { uri: "workspace:/agents/fixture.json", digest: "d".repeat(64) },
            model: { providerId: "fixture-provider", modelId: "fixture-model" },
            instructions: [{ name: "purpose", content: "Fixture draft." }],
          },
          rationale: "Fixture rationale.",
          confidence: 0.5,
          proposing_mechanism: { module: "agent-api/src/skill-proposer.js", identity: "acos-skill-proposer" },
          tool_names: ["update_agent_run_note"],
          created_at_ms: 1_000,
          expires_at_ms: 1_000 + 30 * 24 * 60 * 60 * 1000,
          consumed: false,
        });
        draftStore.calls.length = 0;
        for (let index = 0; index < promoteInputs.length; index += 1) {
          const input = promoteInputs[index];
          const candidateDraftId = input.useKnownDraftId ? draftId : { missing: index };
          await gate.promote(candidateDraftId, input.reference);
        }
        const methods = new Set(draftStore.calls.map((call) => call.method));
        for (const method of methods) {
          assert.ok(["peek", "markConsumed"].includes(method), `unexpected draft store method ${method}`);
        }
      },
    ),
    { numRuns: 75, seed: PROPERTY_SEED + 14 },
  );
});

