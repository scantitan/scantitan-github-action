'use strict';
const LEVELS = {info: 1, low: 2, medium: 3, high: 4, critical: 5, none: 6};
class ScanTitanClient {
  constructor(base, token, transport = fetch) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('api-url must be an HTTPS URL without credentials, query or fragment.');
    if (!/^sti_[a-f0-9]{64}$/.test(token)) throw new Error('A connected-app api-token is required.');
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.transport = transport;
  }
  async request(path, method = 'GET', key) {
    let response;
    try {
      response = await this.transport(this.base + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: {Authorization: 'Bearer ' + this.token, Accept: 'application/json', ...(key ? {'Idempotency-Key': key} : {})},
      });
    } catch { throw new Error('ScanTitan request failed or timed out. Retry with the same idempotency key.'); }
    if (!response.ok) {
      const hints = {401: 'Credential expired or revoked.', 403: 'Check scopes, website binding and plan.', 404: 'Website or scan unavailable.', 422: 'Check ownership and remaining scan allowance.', 429: 'Rate limit reached; retry after a minute.'};
      throw new Error('ScanTitan HTTP ' + response.status + '. ' + (hints[response.status] || 'Request was not accepted.'));
    }
    try { return await response.json(); } catch { throw new Error('Invalid ScanTitan JSON response.'); }
  }
}
async function runScan(client, options, {sleep = ms => new Promise(r => setTimeout(r, ms)), clock = Date.now, onScan = () => {}} = {}) {
  const {asset, key, timeout = 900, poll = 15, failOn = 'high', failIncomplete = true} = options;
  if (!asset || /[\r\n]/.test(asset)) throw new Error('asset-id is required.');
  if (!key || key.length > 120 || /[\r\n]/.test(key)) throw new Error('idempotency-key must be 1–120 characters.');
  if (!Object.hasOwn(LEVELS, failOn)) throw new Error('Invalid fail-on severity.');
  if (!Number.isInteger(timeout) || timeout < 5 || timeout > 86400 || !Number.isInteger(poll) || poll < 5 || poll > 300) throw new Error('Invalid timeout-seconds or poll-seconds.');
  const me = (await client.request('/me')).data;
  if (me.application !== 'github') throw new Error('Create a GitHub connected-app credential for this action.');
  const selected = me.assets.find(a => a.id === asset);
  if (!selected || !selected.verified) throw new Error('Select this website and verify ownership before scanning.');
  let scan = (await client.request('/assets/' + encodeURIComponent(asset) + '/scans', 'POST', key)).data;
  onScan(scan);
  const deadline = clock() + timeout * 1000;
  while (!['Completed', 'Failed', 'Cancelled', 'Canceled'].includes(scan.status)) {
    if (clock() >= deadline) throw new Error('Timed out waiting for scan ' + scan.id + '. The scan may continue; retry with the same idempotency key.');
    await sleep(Math.min(poll * 1000, Math.max(1, deadline - clock())));
    scan = (await client.request('/scans/' + encodeURIComponent(scan.id))).data;
    onScan(scan);
  }
  if (scan.status !== 'Completed') return {scan, findings: [], failure: 'Scan ended with status ' + scan.status + '.'};
  const findings = [];
  let page = 1;
  let last = 1;
  do {
    const response = await client.request('/scans/' + encodeURIComponent(scan.id) + '/results?per_page=100&page=' + page);
    if (!Array.isArray(response.data) || !Number.isInteger(response.meta?.last_page) || response.meta.last_page > 10000) throw new Error('Invalid results pagination.');
    findings.push(...response.data);
    last = response.meta.last_page;
    page++;
  } while (page <= last);
  const incomplete = !scan.coverage_complete || scan.demo;
  const threshold = findings.some(f => (LEVELS[String(f.severity).toLowerCase()] || 0) >= LEVELS[failOn]);
  return {scan, findings, failure: failIncomplete && incomplete ? 'Selected checks did not complete with real results. Review coverage.' : threshold ? 'Findings meet or exceed the ' + failOn + ' severity threshold.' : null};
}
module.exports = {ScanTitanClient, runScan};

