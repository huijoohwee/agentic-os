import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA, encodeGitHubTransitionPolicy, validateGitHubTransitionPolicy }
  from '../src/github-transition-policy.mjs';

const policyPath = new URL('../.agentic-os/github-transition-policy.json', import.meta.url);
const workflowPath = new URL('../.github/workflows/adlc-transition.yml', import.meta.url);

test('committed transition workflow is bound to the canonical authority policy', () => {
  const bytes = readFileSync(policyPath);
  const policy = validateGitHubTransitionPolicy(JSON.parse(bytes));
  assert.deepEqual(bytes, encodeGitHubTransitionPolicy(policy));
  assert.equal(policy.authorityRepository, 'github.com/huijoohwee/agentic-os');
  assert.equal(policy.authorityRef, 'refs/heads/main');
  assert.equal(policy.workflowPath, '.github/workflows/adlc-transition.yml');
  assert.deepEqual(policy.targetRepositories, [
    'github.com/huijoohwee/GameXR',
    'github.com/huijoohwee/agentic-base',
    'github.com/huijoohwee/agentic-commerce-os',
    'github.com/huijoohwee/agentic-graph',
    'github.com/huijoohwee/agentic-os',
  ]);

  assert.equal(policy.schema, GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA);
  assert.deepEqual(policy.historicalIntegrations.map(entry => entry.reviewLocator), [
    'https://github.com/huijoohwee/agentic-commerce-os/pull/133',
    'https://github.com/huijoohwee/agentic-graph/pull/1492',
    'https://github.com/huijoohwee/agentic-graph/pull/1504',
    'https://github.com/huijoohwee/agentic-base/pull/4',
    'https://github.com/huijoohwee/agentic-os/pull/425',
    'https://github.com/huijoohwee/agentic-os/pull/438',
    'https://github.com/huijoohwee/agentic-os/pull/441',
    'https://github.com/huijoohwee/agentic-os/pull/447',
    'https://github.com/huijoohwee/agentic-os/pull/448',
    'https://github.com/huijoohwee/agentic-os/pull/453',
    'https://github.com/huijoohwee/agentic-os/pull/454',
    'https://github.com/huijoohwee/agentic-os/pull/455',
    'https://github.com/huijoohwee/agentic-os/pull/456',
    'https://github.com/huijoohwee/agentic-os/pull/457',
    'https://github.com/huijoohwee/agentic-os/pull/459',
    'https://github.com/huijoohwee/agentic-os/pull/465',
    'https://github.com/huijoohwee/agentic-os/pull/467',
    'https://github.com/huijoohwee/agentic-os/pull/471',
    'https://github.com/huijoohwee/agentic-os/pull/474',
    'https://github.com/huijoohwee/agentic-os/pull/475',
    'https://github.com/huijoohwee/agentic-os/pull/476',
    'https://github.com/huijoohwee/agentic-os/pull/477',
    'https://github.com/huijoohwee/agentic-os/pull/478',
    'https://github.com/huijoohwee/agentic-os/pull/480',
    'https://github.com/huijoohwee/agentic-os/pull/481',
    'https://github.com/huijoohwee/agentic-os/pull/482',
    'https://github.com/huijoohwee/agentic-os/pull/484',
    'https://github.com/huijoohwee/agentic-os/pull/487',
    'https://github.com/huijoohwee/agentic-os/pull/489',
  ]);
  const historicalChecks = new Map([
    ['https://github.com/huijoohwee/agentic-commerce-os/pull/133', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-graph/pull/1492', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-graph/pull/1504', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-base/pull/4', ['Integration Gate']],
    ['https://github.com/huijoohwee/agentic-os/pull/425', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/438', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/441', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/447', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/448', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/453', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/454', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/455', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/456', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/457', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/459', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/465', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/467', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/471', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/474', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/475', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/476', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/477', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/478', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/480', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/481', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/482', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/484', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/487', ['budgets', 'test']],
    ['https://github.com/huijoohwee/agentic-os/pull/489', ['budgets', 'test']],
  ]);
  for (const entry of policy.historicalIntegrations) {
    assert.deepEqual(entry.checkContexts, historicalChecks.get(entry.reviewLocator));
    assert.deepEqual(entry.adoptionScope, [`recovery/current-historical-content/pr-${entry.reviewLocator.split('/').at(-1)}`]);
  }
  assert.deepEqual(policy.historicalIntegrations.find(entry => entry.reviewLocator.endsWith('/pull/4')), {
    schema: 'agentic-os/historical-content-enrollment/v1',
    repository: 'github.com/huijoohwee/agentic-base',
    reviewLocator: 'https://github.com/huijoohwee/agentic-base/pull/4',
    baseRevision: '815a57e89e5eb96139ccef8d6d2c74974c57c934',
    headRevision: '12547c4ee0eec90e5ddb628f4f20fa84f97919c2',
    mergeRevision: '56f73a9cbb6c8498830d0195b35f35876e70f77e',
    treeRevision: '07380949e39efff4523baa67916c6e14b0580524',
    checkContexts: ['Integration Gate'],
    adoptionScope: ['recovery/current-historical-content/pr-4'],
    rationale: 'Current recording of PR #4 merge content with historical protection, required-check policy, rule-suite and method authority unproven.',
  });
  assert.deepEqual(policy.historicalIntegrations.find(entry => entry.reviewLocator.endsWith('/pull/133')), {
    schema: 'agentic-os/historical-content-enrollment/v1',
    repository: 'github.com/huijoohwee/agentic-commerce-os',
    reviewLocator: 'https://github.com/huijoohwee/agentic-commerce-os/pull/133',
    baseRevision: '89c48c3bc9b6f094609f96c0ea1693c6f16b7e4a',
    headRevision: 'f351ec6dba29596f46738831b76f69c931b686f8',
    mergeRevision: '0006d363eaba69bdab2680d19c6445d2537e9ec6',
    treeRevision: '0f6122ded4e1ac907c9457683c5229be9fee8d41',
    checkContexts: ['Integration Gate'],
    adoptionScope: ['recovery/current-historical-content/pr-133'],
    rationale: 'Current recording of PR #133 merge content with historical protection, required-check policy, rule-suite and method authority unproven.',
  });
  assert.deepEqual(policy.historicalIntegrations.find(entry => entry.reviewLocator.endsWith('/425')), {
    schema: 'agentic-os/historical-content-enrollment/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/425',
    baseRevision: '2834a81c5f7d7e30efaa2d0a712ddacd64cd063d',
    headRevision: 'afa0662ec056b849c0d7fb85ed80fb7e7cb641bc',
    mergeRevision: '7f4988180fc5fc369929757fc71a8c928ef8a620',
    treeRevision: 'e3c8a87c8495c4039d597f78d9b2c548112f2656',
    checkContexts: ['budgets', 'test'],
    adoptionScope: ['recovery/current-historical-content/pr-425'],
    rationale: 'Current recording of PR #425 merge content with historical protection, required-check policy, rule-suite and method authority unproven.',
  });
  for (const [number, baseRevision, headRevision, mergeRevision, treeRevision] of [
    ['438', 'df4f6f3c922e81f74c201946d183347430b376ac', '8cd0e1d4872fe8633f1470c6654ba219ad5d0c84', 'e1a08ce7467daeddd7d02bf37b5d81258137e5b8', 'ab4271f21113f65e9b4dc6be58ac4f6735ee6bee'],
    ['441', 'e1a08ce7467daeddd7d02bf37b5d81258137e5b8', '50c38ea3d45cdbfce817ad3e13bcc0c2886efb50', '0a62aae2c1d6dd60a1ac75164fad415dde4f809f', '0469f45ce0e1fd0ff8125b61ebdfff877f3600a7'],
    ['447', '3ee5b70fdf5d45fc67ee34ec69daf8d9dbf59835', '309f6238634a848e9b890e5ff9811db9b13ee2ad', '37948deff5d22b77425c543cc06b5ba716e88776', '264aa395dc473828718e9ea81e16d24482abc5e1'],
    ['448', '37948deff5d22b77425c543cc06b5ba716e88776', '4d7b3f6d2a5b05bfc7a02a7658f9ad8b27898953', 'b2fba11a6fec90ac7c9b2a5b1b8d9f395645532a', '276b30a5c485708fbc0a414a4e4a582b11c52a47'],
    ['453', 'a5be4e06925c6e25f176e83673283828029ce1b2', '9a366a1b98a81df2d9307091fadb1f3a55b4e791', 'aef072fbc887942055555e856ad8044d4b19d2e3', 'd58746d0eef789ec76780477b86dc9adf289f24b'],
    ['454', 'aef072fbc887942055555e856ad8044d4b19d2e3', '6076e762de5b5cc92fb53b2cb7856d6fd6aaeb5d', 'c3839e3f14f356a26e36d0211834cee4236c72cc', '17908d04eb3212a2ddd7e074f95183e0d8cb4d48'],
    ['455', 'c3839e3f14f356a26e36d0211834cee4236c72cc', 'a2a348e89c9085f6f466486d77f07c0df6823eb3', '79bd9d2b22948976dd702bf92f58872e41091322', 'd1ad2fe74ffc4363aa04316d637d380a67d4a1f7'],
    ['456', '79bd9d2b22948976dd702bf92f58872e41091322', 'ac7969984197b912838d6aa98747a1b3ddcfa5e0', '49af645200c943d694185f2c935b32e82a778efb', '602d328be6bda127afc03dc98454288fa61f1247'],
    ['457', '49af645200c943d694185f2c935b32e82a778efb', '442fa6d80a98ef41154ffd270e0d04e77c1b4470', 'e3aa53001da0f6f50573b5fe2227735d4b7446e3', 'caaf60686590b8ca37bb5b994fb651fb8ae9ed76'],
    ['459', '8a5c638208a81ca19cc85ed2bae3b728a2f62bb4', 'bc223be5e0e94eb18c1dbaeb24743ec21c087b50', '1529120d50ec3f068a93273ec244eaebc5065d08', 'a736c11f9afa7505b3ec59955326f74068a5b43a'],
    ['465', '9c50837c86d06851e7694b9cb0dc4d730fd2254e', '584e29b9ee6524d0934b2be5a4a96422d431a057', '8b3a7b27b01dc119596b46e6b2de902c0910d6b3', '53e26804ff66110abb095ddbac0347113ef93129'],
    ['467', 'ec378a9c98ec4d50d11afdee635d232ad65a3eb4', 'a93eb94658a7ddce3417678bf2dfc8beae195a68', '9b178f7125b4651f87f5625763eefc826a785859', 'eacb6991cdbd502000d2905996000c035534f3c7'],
    ['471', '3e9c51c76c5f50b1283ff5c61597c307513809a5', '9072e34ea01a9f4a72a81705ca92d3f59bbb0752', '05f5b312ce2a43a1f8aeca33ff63d9c294bd7172', '0e3834d73cd5bb4ebffbafcc0fa76c09a84cfdb7'],
    ['474', '86b57e5d618c5f3fd5a8d2841badb29ba2f363ed', 'bf9f919a79223bd8087d2bc0d478a009214b0741', '883519ecbca3690a5c5c785efba383227e1a5977', '0ca32acaedc3a5f67844c2b015a094f492efd4bb'],
    ['475', '883519ecbca3690a5c5c785efba383227e1a5977', 'b8fb84454cc560012bf88d9fa678c97c4a43217d', '27dedbdd6dec8bd4be8fa2eda530d8a6b697a4c6', '07f74bd08a38bfcb25d47987733308ffd20746cd'],
    ['476', '27dedbdd6dec8bd4be8fa2eda530d8a6b697a4c6', 'a5a70b40275b4e43b77c7e3033cb737729d27feb', 'cb4149dc7581e48923de851b424e39bc339afb5a', 'bc6aadd2331db05d41480488b3b26f014207fcb6'],
    ['477', 'cb4149dc7581e48923de851b424e39bc339afb5a', 'fe7f493fc51702438fe6b14d07a001260ba25f7f', 'e5c14e5c0236cba859ee8996f8b7b3660a256e20', '6c5e0fb2aab95cd3ee3ef70f7a570b84d985458e'],
    ['478', 'e5c14e5c0236cba859ee8996f8b7b3660a256e20', 'aadcd19641d9ef2273b4bb7ea89227f501375dce', '91e39eac8758573ce8e1103d8617ecfd53ce3259', '43f023e4f84411f58d904836071c2710169125f3'],
    ['480', '1eb168782a4d9b2d519d9b9207ffc816fe70db95', '11364995b4a1834d431e89d78c16a44e4ae51340', '82c3ba7b1b4178e7c7b230e2cb0794aad3a9b5e0', 'ab85ae1211f50ad60267f76e0ec86b19fa92d737'],
    ['481', '82c3ba7b1b4178e7c7b230e2cb0794aad3a9b5e0', '556b5220b4c31172dd726f0113f9cf43b384702c', '96af1d3fab0dc2ecfa7cfb2ac570a19c927bfee8', '66543f07adf995149641460c00964f7cad91fce0'],
    ['482', '96af1d3fab0dc2ecfa7cfb2ac570a19c927bfee8', '20efbe575decdbb9de73f21fa0f6d8aa1a56c967', '255114403e0910f240081d37d2a6e97267fcba36', '8a280cf086e9ccf295116f1aee1083ff84a37faf'],
    ['484', '6623ce5958ba8c9752d1b7fa81b9acd9281ae1ac', '065eef81e25ca9f77475d8e20f7f01d9cf2127e1', 'b89ba6865c276112de1657514d418439ad5011a4', '7b1054df990c7d58b93b5fa68189ec75dc7ac26d'],
    ['489', '1397d69aa86e113e26cf70fa9810bee78a61e18a', '28c3b9fcd04b050236f311b88be8803499d3457b', 'a57da5df58d5b77436a39787e4d844b4486abde1', 'dd2e7b834e7abccf7d1c25533d3a70268c1cf4ba'],
  ]) {
    const reviewLocator = `https://github.com/huijoohwee/agentic-os/pull/${number}`;
    assert.deepEqual(policy.historicalIntegrations.find(entry => entry.reviewLocator === reviewLocator), {
      schema: 'agentic-os/historical-content-enrollment/v1',
      repository: 'github.com/huijoohwee/agentic-os',
      reviewLocator,
      baseRevision,
      headRevision,
      mergeRevision,
      treeRevision,
      checkContexts: ['budgets', 'test'],
      adoptionScope: [`recovery/current-historical-content/pr-${number}`],
      rationale: `Current recording of PR #${number} merge content with historical protection, required-check policy, rule-suite and method authority unproven.`,
    });
  }
  assert.equal(policy.preservationAdoptions[0].historicalSuccessionAuthorityProven, false);
  assert.deepEqual(policy.retentionAdoptions, [{
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/cleanup-retirement-manifest-compat',
    targetHead: 'bc223be5e0e94eb18c1dbaeb24743ec21c087b50',
    merge: '1529120d50ec3f068a93273ec244eaebc5065d08',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/459',
    quarantineCoordinate: 'bfefef5d014ffd25c4385692763ed7c5877268b59bd50015f2638d4bb9aa4407',
    originalReceiptDigest: 'ac747f8ce44ff8d112dd06f140390ec120e27df412c8716c1a09c3b5c93bbea4',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/storage-head-drift-resume',
    targetHead: 'c9a88dc1bb69528c104b8e49b69ab58dcab0e45b',
    merge: '26a98d41c43bc8eefa5b9374b38951ce2ef755a3',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/487',
    quarantineCoordinate: '30f5e2b1b7896321d09993cee4696f8e421a73daf87b24e31dfe1f7b71ab57f4',
    originalReceiptDigest: '0dcf4893ba1871c2b256f78b4d94129f69fe1e25ae2d279f69eebeb1024498a3',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/current-retention-pr474',
    targetHead: 'b8fb84454cc560012bf88d9fa678c97c4a43217d',
    merge: '27dedbdd6dec8bd4be8fa2eda530d8a6b697a4c6',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/475',
    quarantineCoordinate: '2fec5fe9ee4e5c046357e2033c5414077fe5f27db452c1c755b04878f5fe4de0',
    originalReceiptDigest: '9a9a6da8be402615a8599b63280f3937a410b031e80e7a83ff0b16385a4d8af6',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-cba000d3779d/software-forensics-preset',
    targetHead: 'e17b54e4a574a8086ecb53fd9b7d242dc79fbc82',
    merge: '3846c48dba4b40702451640e3e78e6bcc91408f4',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/397',
    quarantineCoordinate: '4b73b84c47d82b1ec6f4a70ce06e8c1ea1a56ac6e48000dbbaebeac944d505f6',
    originalReceiptDigest: 'fa4ed263252951ee38e86821285e64be81ad3d2f5255c4505c8df70aa9932265',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/current-recovery-pr467',
    targetHead: '1fda0959ccf5ff657e973e87c83cfa45b818b6ff',
    merge: '458590ef91dfebd262b374bd38ce135ba1da1a53',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/468',
    quarantineCoordinate: 'f35014d2482ab40b815622a1a11e9cfffbd9e98e026309d81f50206c9ca4ca0a',
    originalReceiptDigest: '3fd9f58e4fc5729681fe848a8535abae9622a698a08cd5518450edafc3269f35',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/external-authority-root',
    targetHead: 'bf9f919a79223bd8087d2bc0d478a009214b0741',
    merge: '883519ecbca3690a5c5c785efba383227e1a5977',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/474',
    quarantineCoordinate: '7e6d8203b7db007d3f8ccb5f0e9bd3ec368e373a4b42c241d28c30e2c64d4c78',
    originalReceiptDigest: '1a40db91476ed09ab63001174940417cb8d9dad006b737de67d3446630d3b1fb',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/current-recovery-pr447',
    targetHead: '4d7b3f6d2a5b05bfc7a02a7658f9ad8b27898953',
    merge: 'b2fba11a6fec90ac7c9b2a5b1b8d9f395645532a',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/448',
    quarantineCoordinate: '242cb16bb2e2034465f883c1aa9612de6b060bc2eccee67d9955d2926b8e3dfe',
    originalReceiptDigest: '90c04dd8a9e33e945d2df291258e7b6cd29726e6bd6b7269f4d723e476117425',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-os',
    targetRef: 'agent/device-0232231d4a19/pr456-current-recovery-v2',
    targetHead: '442fa6d80a98ef41154ffd270e0d04e77c1b4470',
    merge: 'e3aa53001da0f6f50573b5fe2227735d4b7446e3',
    reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/457',
    quarantineCoordinate: 'ea74a43255305cb85122e4faad4309430f875ef4fdfeb8df1a69887c3a3df7ce',
    originalReceiptDigest: '0622a4e7c8a8d0d9f3bc7174f7f711eaa0a0f4360bad26da700db3e7d7390e5e',
    historicalQuarantineAuthorityProven: false,
  }, {
    schema: 'agentic-os/current-quarantine-adoption/v1',
    repository: 'github.com/huijoohwee/agentic-graph',
    targetRef: 'agent/device-0232231d4a19/browser-history-authorization-stop',
    targetHead: 'bf533bf09735732b2f225fde161c859c4ba66ee3',
    merge: 'ebd4bc5e92cd283c04196ab77d024366a4f45ac3',
    reviewLocator: 'https://github.com/huijoohwee/agentic-graph/pull/1492',
    quarantineCoordinate: '4defda64b9a1b27648c9f058de59a85a01ee30c292f554cf0030ea3a7267dacd',
    originalReceiptDigest: 'd66754a10cb0decfdd527f930d89c52f2875f91cba2799611527518e4ac85696',
    historicalQuarantineAuthorityProven: false,
  }]);

  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /operation_payload:/u);
  assert.match(workflow, /operation_input_digest:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /agentic-os-transition\.mjs validate-event/u);
});
