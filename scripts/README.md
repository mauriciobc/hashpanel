# Scripts

All cron/collection scripts are POSIX `sh` (Alpine/BusyBox compatible). The former
`*-alpine.sh` variants were duplicates and have been merged into the canonical names below.

## Cron
- `setup-cron.sh` — installs/updates the daily collection cron job (`npm run cron:setup`).
- `cron-collect-history.sh` — the job itself: collects history and publishes the daily
  report (`npm run cron:test`).
- `test-cron.sh` — manual sanity check for the cron scripts inside the container.

## Dev / maintenance utilities
- `clear-database.js` — wipes the database (`npm run db:clear`).
- `create-test-data.js` — seeds test data (`npm run test:weekly:create-data`).
- `diagnose-collection.js` — diagnoses collection issues (`npm run diagnose:collection`).
- `test-weekly-history.js` — weekly history smoke test (`npm run test:weekly`).
- `test-listener-manual.js` — manual WebSocket listener test.

## Repository helpers
- `create-codeberg-repo.sh`, `setup-codeberg-auth.sh`, `update-inside-container.sh`.

## Installers (repository root)
The canonical installer is `../install.sh` and the updater is `../update-from-github.sh`.
The remaining root install/Caddy scripts (`install-quick.sh`, `install-from-github.sh`,
`install-hashpanel-from-github.sh`, `caddy-*.sh`, `install-caddy-from-github.sh`) are
variant/legacy helpers; prefer Docker deployment (`docker-compose.yml`) or `install.sh`.
