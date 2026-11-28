# Backend CI test scope

The component impact classifier selects backend checks for pull requests. Selected PRs run lint, type check, build, the existing application gates and both auth E2E modes. Jest uses `--findRelatedTests` with the changed backend source files from the PR merge base to its head.

Changes to backend test configuration or shared test support, Prisma schema or migrations, `packages/shared`, lockfiles, or CI files trigger all three unit shards and the real-database suite. Deletions, unavailable comparisons, and target branches without the scope helper also trigger full coverage. A related run includes the real-database suite when it changes Prisma files, Prisma or integrity specs, or backend repositories or persistence code.

Pushes to `main`, `dev`, and `preview` that match the workflow paths, merge-queue runs, the 03:17 KST nightly, and manual `ci` runs use full coverage. The three Jest shards and the real-database suite run in parallel. The required `backend · type-check · lint · test` check validates the application and test jobs against the selected scope. Deployment still depends on that check and both auth E2E modes, and runs only on the existing preview and main push paths.
