'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const net = require('node:net');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

async function main() {
  const [cert, key, output] = process.argv.slice(2).map(p => p && path.resolve(p));
  assert.ok(cert && key && output, 'Pass a fixture certificate, private key and evidence directory.');
  const folder = path.resolve(__dirname, '..');
  fs.mkdirSync(output, {recursive: true});
  const probe = net.createServer();
  probe.listen(18089, '127.0.0.1');
  await once(probe, 'listening');
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, [path.join(__dirname, 'https-fixture.cjs')], {
    cwd: folder, windowsHide: true, env: {...process.env, SCANTITAN_FIXTURE_CERT: cert, SCANTITAN_FIXTURE_KEY: key}, stdio: 'ignore',
  });
  const ca = fs.readFileSync(cert);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      ready = await new Promise(resolve => {
        https.get('https://127.0.0.1:18089/health', {ca, timeout: 1000}, r => {r.resume(); resolve(r.statusCode === 200);}).on('error', () => resolve(false));
      });
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Private HTTPS fixture must be ready with TLS verification enabled.');
    const outputFile = path.join(output, 'step-output.txt');
    const summaryFile = path.join(output, 'step-summary.md');
    fs.writeFileSync(outputFile, ''); fs.writeFileSync(summaryFile, '');
    const action = spawn(process.execPath, ['index.cjs'], {cwd: folder, windowsHide: true, env: {
      ...process.env, NODE_EXTRA_CA_CERTS: cert, RUNNER_TEMP: output, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile,
      'INPUT_API-URL':'https://127.0.0.1:18089/api/v2/integrations/apps', 'INPUT_API-TOKEN':'sti_'+'a'.repeat(64),
      'INPUT_ASSET-ID':'fixture-site', 'INPUT_IDEMPOTENCY-KEY':'marketplace-fixture', 'INPUT_TIMEOUT-SECONDS':'30', 'INPUT_POLL-SECONDS':'5',
    }, stdio: ['ignore', 'pipe', 'pipe']});
    let log=''; action.stdout.on('data', x => log+=x); action.stderr.on('data', x => log+=x);
    const [code] = await once(action, 'exit');
    fs.writeFileSync(path.join(output, 'action.log'), log);
    assert.equal(code, 1, 'Synthetic incomplete coverage must fail the action gate.');
    const values = Object.fromEntries(fs.readFileSync(outputFile, 'utf8').trim().split('\n').map(line => {const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
    const reportPath = path.resolve(values['report-path']);
    assert.ok(reportPath.startsWith(output+path.sep));
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.findings.length, 2); assert.equal(report.scan.demo, true);
    assert.equal(values['coverage-complete'], 'false'); assert.match(report.gate_failure, /real results/);
    assert.ok(!fs.readFileSync(summaryFile,'utf8').includes('sti_'+'a'.repeat(64)));
    const result = {passed:true, transport:'HTTPS with verified fixture certificate', process:'actual separate Node action process', exit_code:code, expected_gate_failure:true, findings:2, report_saved:true, real_network_scans:false};
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally { if (server.exitCode === null) server.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
