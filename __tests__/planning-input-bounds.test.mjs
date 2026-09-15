import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../runtime/planning/product-contract-primitives.mjs';
test('planning digests reject cyclic and accessor-shaped input without executing accessors', () => {
  const cycle=[];cycle.push(cycle);assert.throws(()=>canonicalJson(cycle),/cycles/);
  let reads=0;const value=Object.defineProperty({},'secret',{enumerable:true,get(){reads++;return 1;}});
  assert.throws(()=>canonicalJson(value),/data properties/);assert.equal(reads,0);
  assert.equal(canonicalJson({z:-0,a:[true,null,4]}),'{'+'"a":[true,null,4],"z":0}');
});
test('both planning CLIs refuse oversized and malformed UTF-8 input', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'planning-input-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const [name,bytes] of [['large',Buffer.alloc(128001,32)],['utf8',Buffer.from([0xff])]]) {
    const input=path.join(root,name);fs.writeFileSync(input,bytes);
    for(const entry of ['coordination-scheduler','goal-completion-runtime']) {
      const file=fileURLToPath(new URL('../runtime/planning/'+entry+'.mjs',import.meta.url));
      const result=spawnSync(process.execPath,[file,'plan','--input='+input,'--json'],{encoding:'utf8',timeout:10000,maxBuffer:16000});
      assert.equal(result.error,undefined);assert.equal(result.status,1);
      assert.match(result.stdout+result.stderr,name==='large'?/byte budget exceeded/:/encoded data was not valid/);
    }
  }
});
