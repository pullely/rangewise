# range-worker-tests — overview

Tests for `apps/range-worker` on a real SQLite engine (`node:sqlite`) with every
migration applied, so the seeded rules table and the audit writes are the ones
D1 runs. Covers the extractor, the evaluator against the seeded rules, and the
HTTP flow (rules list, passing and failing checks, validation, 404/401).
