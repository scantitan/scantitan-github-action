const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ScanTitanClient, runScan} = require('../client.cjs');
const token = 'sti_' + 'a'.repeat(64);
const complete = {id:'scan-1', status:'Completed', coverage_complete:true, demo:false};
function fixture({scan = complete, pages = [[{severity:'Low'}]], failStart = false} = {}) {
  const calls = [];
  const client = new ScanTitanClient('https://portal.example/api', token, async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/me')) return {ok:true, json:async()=>({data:{application:'github',assets:[{id:'site',verified:true}]}})};
    if (url.endsWith('/scans') && failStart) return {ok:false,status:422};
    if (url.includes('/results?')) { const p=Number(new URL(url).searchParams.get('page')); return {ok:true,json:async()=>({data:pages[p-1],meta:{last_page:pages.length}})}; }
    return {ok:true,json:async()=>({data:scan})};
  });
  return {client,calls};
}
const options = {asset:'site',key:'run-1',poll:5,timeout:5};
test('rejects insecure URLs and malformed tokens', () => {
  for (const url of ['http://example.com','https://a:b@example.com','https://example.com?key=x','https://example.com#x']) assert.throws(()=>new ScanTitanClient(url,token));
  assert.throws(()=>new ScanTitanClient('https://example.com','root-key'));
});
test('paginates results and fails at severity threshold', async () => {
  const {client,calls}=fixture({pages:[[{severity:'Low'}],[{severity:'High'}]]});
  const result=await runScan(client,options);
  assert.equal(result.findings.length,2);
  assert.match(result.failure,/threshold/);
  assert.equal(calls[1].options.headers['Idempotency-Key'],'run-1');
  assert.equal(calls[1].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
});
test('unknown or simulated coverage fails even with no findings', async () => {
  for(const scan of [{...complete,coverage_complete:false},{...complete,demo:true}]) {
    assert.match((await runScan(fixture({scan,pages:[[]]}).client,options)).failure,/real results/);
  }
});
test('none threshold and explicit coverage override work', async () => {
  const result=await runScan(fixture({scan:{...complete,coverage_complete:false},pages:[[{severity:'Critical'}]]}).client,{...options,failOn:'none',failIncomplete:false});
  assert.equal(result.failure,null);
});
test('failed scans always fail and do not fetch results', async () => {
  const {client,calls}=fixture({scan:{...complete,status:'Failed'}});
  assert.match((await runScan(client,options)).failure,/Failed/);
  assert.equal(calls.length,2);
});
test('timeout is bounded and identifies scan', async () => {
  let now=0;
  await assert.rejects(runScan(fixture({scan:{id:'scan-1',status:'Running'}}).client,options,{clock:()=>now,sleep:async ms=>{now+=ms;}}),/Timed out.*scan-1/);
});
test('API failures never echo response contents', async () => {
  await assert.rejects(runScan(fixture({failStart:true}).client,options),/allowance/);
});
test('refuses wrong application and unverified assets', async () => {
  for(const me of [{application:'wordpress',assets:[]},{application:'github',assets:[{id:'site',verified:false}]}]) {
    await assert.rejects(runScan({request:async()=>({data:me})},options),/credential|verify/);
  }
});
test('validates inputs before making requests', async () => {
  for(const fields of [{timeout:NaN},{poll:1},{key:'x'.repeat(121)},{failOn:'unknown'},{failOn:'constructor'}]) await assert.rejects(runScan({}, {...options,...fields}));
});

