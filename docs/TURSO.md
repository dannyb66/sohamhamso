# Retired database runbook

Turso and libSQL are no longer dependencies of this repository. Do not restore
remote corpus adapters, credentials, seed scripts or backup workflows.

Use [D1 and static corpus operations](D1-CUTOVER.md) for current deployment,
subscriber storage, aggregate reporting, recovery and retirement instructions.
The former provisioning and restore commands remain in Git history only.

## Legacy data retention

On 2026-10-25, read-only inventory attempts against the legacy corpus and PII
endpoints returned `BLOCKED` from the provider. No export or reconciliation could
be completed. The databases and operator-local credentials were preserved;
removing an application dependency does not establish that historical data can
be deleted. Restore read access, make private verified exports, and reconcile
records before retiring either database or its credentials.
