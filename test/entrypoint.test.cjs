const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {main} = require('../index.cjs');
test('action writes safe summary, outputs and downloadable JSON before failing gate', async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scantitan-action-'));
  const keys=['INPUT_API-TOKEN','INPUT_ASSET-ID','GITHUB_OUTPUT','GITHUB_STEP_SUMMARY','RUNNER_TEMP'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const oldFetch=global.fetch;
  try {
    process.env['INPUT_API-TOKEN']='sti_'+'a'.repeat(64);
    process.env['INPUT_ASSET-ID']='site';
    process.env.GITHUB_OUTPUT=path.join(directory,'output');
    process.env.GITHUB_STEP_SUMMARY=path.join(directory,'summary');
    process.env.RUNNER_TEMP=directory;
    const scan={id:'scan-1',status:'Completed',coverage_complete:true,demo:false,report_url:'https://portal.example/?scan=scan-1'};
    global.fetch=async url=>({ok:true,json:async()=>url.endsWith('/me')?{data:{application:'github',assets:[{id:'site',verified:true}]}}:url.includes('/results?')?{data:[{id:'f',severity:'High',title:'<script>alert(1)</script> | [link](https://evil.test)'}],meta:{last_page:1}}:{data:scan}});
    await assert.rejects(main(),/threshold/);
    const output=fs.readFileSync(process.env.GITHUB_OUTPUT,'utf8');
    assert.match(output,/scan-id=scan-1/);
    const report=output.split('\n').find(row=>row.startsWith('report-path=')).slice(12);
    assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).findings.length,1);
    const summary=fs.readFileSync(process.env.GITHUB_STEP_SUMMARY,'utf8');
    assert.ok(!summary.includes('<script>') && !summary.includes('[link]'));
    assert.ok(!summary.includes(process.env['INPUT_API-TOKEN']));
  } finally {
    global.fetch=oldFetch;
    for(const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key]=previous[key];
    const relative=path.relative(path.resolve(os.tmpdir()),path.resolve(directory));
    assert.ok(relative.startsWith('scantitan-action-') && !relative.includes(path.sep));
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

