'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const {ScanTitanClient, runScan} = require('./client.cjs');
const input = name => process.env['INPUT_' + name.toUpperCase().replace(/ /g, '_')] || '';
const commandEscape = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const markdown = value => String(value).slice(0, 1000).replace(/[\r\n]/g, ' ').replace(/[<>&|[\]\x60\\]/g, c => '&#' + c.charCodeAt(0) + ';');
function outputs(scan, count) {
  const values = {'scan-id': scan.id, status: scan.status, 'report-url': scan.report_url || '', 'coverage-complete': String(!!scan.coverage_complete && !scan.demo)};
  if (count !== undefined) values['findings-count'] = String(count);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k,v]) => k + '=' + String(v).replace(/[\r\n]/g, '')).join('\n') + '\n');
}
async function main() {
  const token = input('api-token');
  process.stdout.write('::add-mask::' + commandEscape(token) + '\n');
  const key = input('idempotency-key') || 'github-' + crypto.createHash('sha256').update([process.env.GITHUB_REPOSITORY, process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, process.env.GITHUB_JOB].join(':')).digest('hex');
  const incomplete = input('fail-on-incomplete') || 'true';
  if (!['true', 'false'].includes(incomplete)) throw new Error('fail-on-incomplete must be true or false.');
  const result = await runScan(new ScanTitanClient(input('api-url') || 'https://portal.scantitan.com/api/v2/integrations/apps', token), {
    asset: input('asset-id'), key, timeout: Number(input('timeout-seconds') || 900),
    poll: Number(input('poll-seconds') || 15), failOn: (input('fail-on') || 'high').toLowerCase(), failIncomplete: incomplete === 'true',
  }, {onScan: scan => outputs(scan)});
  outputs(result.scan, result.findings.length);
  const reportPath = path.join(process.env.RUNNER_TEMP || process.cwd(), 'scantitan-report-' + crypto.createHash('sha256').update(result.scan.id).digest('hex').slice(0, 16) + '.json');
  fs.writeFileSync(reportPath, JSON.stringify({schema_version: 1, scan: result.scan, findings: result.findings, gate_failure: result.failure}, null, 2), {mode: 0o600});
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'report-path=' + reportPath.replace(/[\r\n]/g, '') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = ['## ScanTitan website scan', '', 'Status: **' + markdown(result.scan.status) + '**',
      'Coverage: **' + (result.scan.coverage_complete && !result.scan.demo ? 'Selected checks completed' : 'Incomplete or simulated') + '**',
      'Findings: ' + result.findings.length, '', 'Open the report-url step output to review the authenticated report.',
      '', '| Severity | Finding |', '| --- | --- |',
      ...result.findings.slice(0, 100).map(f => '| ' + markdown(f.severity) + ' | ' + markdown(f.title) + ' |'),
      '', result.failure || 'No findings met the configured failure threshold. Review the report and coverage.'];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  }
  if (result.failure) throw new Error(result.failure);
}
if (require.main === module) main().catch(error => { process.stdout.write('::error::' + commandEscape(error.message) + '\n'); process.exitCode = 1; });
module.exports = {main};

