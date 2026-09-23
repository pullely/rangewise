# range-worker — architecture

```
recruiter ──► api-edge ──(resolveActor)──► range-worker ──► D1 (range_*, events_*)
                                                        ├─► membership-worker (context)
                                                        └─► policy-worker (authorize)
```

- Reachable only over the `RANGE_WORKER` service binding (`workers_dev: false`).
- Every route runs membership authorization-context then policy authorize; a
  deny is `404`, never `403`.
- `src/engine/extract.ts` reads one pay statement, vague pay words and benefit
  mentions out of the ad; `src/engine/evaluate.ts` applies each jurisdiction's
  rule in force on the check date. Neither touches I/O.
- The audit row is written with portable SQL (`appendEvent` + `INSERT …
  SELECT`), best-effort after the check is computed.
- Depends on `db-migrate`, so a run that adds a rules migration applies it
  before this worker's code that reads it goes live.
