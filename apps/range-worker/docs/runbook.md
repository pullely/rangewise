# range-worker — runbook

- **Health:** `GET /health` on the worker (via a service binding) reports which
  bindings are configured: database, membership, policy.
- **Every route answers 404 for a member:** policy-worker is running an old
  action table without `range.read`/`range.write`. A change to
  `packages/policy-engine` does not redeploy policy-worker by itself: touch its
  `component.yaml` and merge.
- **Every call answers 503:** migration `200_range_rules` has not applied in
  that environment. Check the `db-migrate` lane of the deploy run.
- **A rule is wrong or out of date:** never edit the row. Land a migration that
  sets `effective_to` on the old version and inserts version n+1 with the new
  `effective_from`, citation, source URL and `verified_on`.
