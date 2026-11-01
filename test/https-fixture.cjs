'use strict';
const fs = require('node:fs');
const https = require('node:https');
const token = 'sti_' + 'a'.repeat(64);
const base = '/api/v2/integrations/apps';
const scan = {id: 'fixture-scan', status: 'Completed', coverage_complete: false, demo: true};
const server = https.createServer({key: fs.readFileSync(process.env.SCANTITAN_FIXTURE_KEY), cert: fs.readFileSync(process.env.SCANTITAN_FIXTURE_CERT)}, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = new URL(req.url, 'https://localhost:18089');
  if (url.pathname === '/health') { res.end('{}'); return; }
  if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); res.end('{}'); return; }
  if (url.pathname === base + '/me') res.end(JSON.stringify({data: {application: 'github', assets: [{id: 'fixture-site', verified: true}]}}));
  else if (url.pathname === base + '/assets/fixture-site/scans' && req.method === 'POST' && req.headers['idempotency-key']) res.end(JSON.stringify({data: scan}));
  else if (url.pathname === base + '/scans/fixture-scan') res.end(JSON.stringify({data: scan}));
  else if (url.pathname === base + '/scans/fixture-scan/results') {
    const page = Number(url.searchParams.get('page'));
    res.end(JSON.stringify({data: [{id: 'fixture-finding-' + page, severity: page === 1 ? 'High' : 'Low', title: 'Synthetic fixture finding ' + page}], meta: {page, last_page: 2}}));
  } else { res.writeHead(404); res.end('{}'); }
});
server.listen(18089, '127.0.0.1');
process.once('SIGTERM', () => server.close(() => process.exit(0)));
