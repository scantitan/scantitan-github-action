# ScanTitan Website Security Action

Maintainer and support: info@scantitan.com. Never send credentials or private scan evidence by email.

Scan a selected, verified website and fail a deployment when findings meet a severity threshold or coverage is incomplete. The action scans a deployed website, not repository source code.

In ScanTitan, add and verify your website, select a plan, then create a **GitHub** credential in **Account & plan → Connected apps** with assets:read, scans:read and scans:run. Save it as a GitHub Actions secret.

After checking out this repository, use:

```yaml
- uses: scantitan/scantitan-github-action@v0.1.3
  id: scantitan
  with:
    api-token: ${{ secrets.SCANTITAN_API_TOKEN }}
    asset-id: ${{ vars.SCANTITAN_ASSET_ID }}
    fail-on: high
    fail-on-incomplete: 'true'
```

Run this after deployment to a reachable, verified staging or production website. A Marketplace listing is available only after publishing the release. For production, pin the released action to its full commit SHA.

Scan limits follow your plan. The default retry key includes repository, workflow run, attempt and job. Repeated requests within an attempt reuse a scan; a new attempt can consume another scan. Set idempotency-key to a deployment identifier for reuse across attempts. Use a separate key for each website.

Outputs: scan-id, status, report-url, report-path, findings-count, coverage-complete. report-path points to a JSON report in the runner's temporary directory, written before evaluating the gate. Upload it in a following always() step using actions/upload-artifact, with path set to steps.scantitan.outputs.report-path. Failed/cancelled scans always fail. Default timeout: 900 seconds; timeout does not cancel the server scan. Demo results fail the coverage gate by default. fail-on: none disables only the severity gate. All results are paginated; summaries show the first 100 findings.

Do not expose credentials to untrusted pull requests or execute untrusted code using pull_request_target. Only scan authorized assets.

Tests: Node 24, `node --test test/*.test.cjs`. No build step or runtime dependencies.

