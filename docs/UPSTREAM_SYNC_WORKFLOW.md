# Upstream synchronization workflow

Use this procedure to integrate upstream TREK updates without losing the
customizations in [FORK_CUSTOMIZATIONS.md](FORK_CUSTOMIZATIONS.md).

Known upstream defects are tracked separately in
[UPSTREAM_ISSUES.md](UPSTREAM_ISSUES.md). Consult it when a sync surfaces
unexpected behavior, so an inherited defect is not mistaken for a fork
regression.

## 1. Inspect before merging

```bash
git status --short --branch
git remote -v
git fetch upstream
git log --oneline --decorate main..upstream/main
git diff --stat main...upstream/main
```

Start only from a clean working tree. Preserve unrelated work on its own branch
or in a clearly named stash. Never include `.env`, credentials, tokens, or
deployment secrets in the comparison, commits, or documentation.

## 2. Create a dedicated integration branch

```bash
git switch main
git pull --ff-only origin main
git switch -c sync/upstream-<version>
git merge --no-ff upstream/main
```

Do not force-push or reset protected `main`. Resolve conflicts by understanding
both sides; do not automatically accept all upstream or all fork changes.

## 3. Resolve with the preservation checklist

For every conflict or upstream rewrite:

1. Read the corresponding item in `FORK_CUSTOMIZATIONS.md`.
2. Preserve upstream fixes unless they contradict a documented fork invariant.
3. Reapply the fork behavior using the smallest maintainable integration.
4. Keep workflow repository guards, private image coordinates, Tailscale agent
   deployment, Vacay/Obsidian behavior, and PWA cache semantics intact.
5. Record any new recurring merge decision in the preservation document.
6. For mobile trip-plan or reservation changes, verify that assignment-linked
   reservations still persist `assignment_id`, and that mobile place rows keep
   the planned-slot-first / reservation-time-fallback display rule.
7. For Vacay/Obsidian changes, verify daily-note `假期` remains authoritative
   for actual leave, `请假计划.md` remains authoritative for planned leave,
   PTO/公共假期/病假 colors remain distinct, and the beside-year company-holiday
   count includes PTO and 公共假期 but excludes 病假, and daily-note-over-plan
   precedence is preserved. Reconciliation stays behind the
   explicit sync operation, and `getEntries` remains database-read-only.

Pay special attention to `.github/workflows`, `client/src/App.tsx`,
`client/vite.config.js`, Vacay client/server code, locale files, deployment
scripts, and Docker/Compose configuration.

## 4. Audit changed contracts after merging

A clean textual merge is not behavioral proof. Before declaring the sync
preserved, inspect every producer and consumer when an upstream rewrite changes
an API, hook, store, or projected model shape. In particular:

- Update exact-object assertions and fixtures when a returned object gains a
  deliberate field; the full client suite caught stale `upNext` assertions after
  the mobile timeline added its linked-reservation context.
- Trace reservation links through REST/MCP writes, WebSocket and offline
  hydration, reload, and explicit null-unlink paths. Verify same-day reuse does
  not immediately reattach an explicit unlink.
- Use one mobile time-resolution helper for place rows and the Go/up-next card:
  an explicit assignment slot wins, otherwise the linked reservation range is
  used, and shared place defaults are not mistaken for assignment overrides.
- Treat an empty externally supplied member roster as loading, not as proof of
  a solo trip; verify companion-only packing and collaboration controls after
  the roster resolves.
- Keep Obsidian filesystem reconciliation behind the authenticated sync
  operation, make it transactional, and prove `getEntries` performs no file
  traversal or database mutation.

Record any new recurring decision in `FORK_CUSTOMIZATIONS.md` before review.

## 5. Verify locally

Run the gates relevant to the changed areas. For a broad upstream integration,
use the full set:

```bash
npm run build
npm run lint
npm test
node shared/scripts/i18n-parity.mjs --strict
```

Run focused regression tests before the broad suite for every preserved
customization. Client Vitest paths must be workspace-relative. If shared
schemas or translations changed, build `shared` before client tests consume
`shared/dist`:

```bash
npm run build --workspace=shared
npm run test --workspace=client -- src/...
```

If a test cannot be run locally, state that explicitly in the PR and rely on a
named CI gate rather than implying it passed. Keep known unrelated failures
separate from regressions in the changed preservation slice.

## 6. Commit, push, and review

```bash
git add <intentional-files>
git commit -m "chore: integrate upstream <version>"
git push -u origin sync/upstream-<version>
gh pr create --repo syyangv/TREK --base main --head sync/upstream-<version>
```

The PR description should list:

- upstream ref/version and commit;
- fork behaviors deliberately preserved;
- conflict-resolution decisions;
- local verification and known limitations;
- any migration, persistence, or deployment risk.

Require all repository checks to pass. Address failures through additional PR
commits; do not bypass branch protection or silently weaken a gate.

## 7. Release and deploy

After merging:

1. Monitor main CI and the security scan for the exact merge commit.
2. Confirm `Build & Push Docker Image` publishes a stable release and a
   multi-architecture immutable digest.
3. If CI is still running when the release verifier times out, wait for the
   exact commit's conclusion; do not treat a timeout as permission to deploy.
   Rerun the release workflow only after required workflows pass.
4. If Docker Scout fails before scanning because of transient infrastructure
   (for example, an action-download 403), rerun only that failed scan. If it
   reports fixed high/critical CVEs, fix dependencies in a protected change
   and rebuild; never bypass the security gate.
5. Compare the published `trek-<version>-release.json` provenance asset with
   the gated source SHA, release SHA, immutable digest, and local Compose file
   hashes before generating `promotion.json`.
6. Review, SSH-sign, and fast-forward-push the promotion commit to the
   protected `deploy/production` branch. Verify the signer against the
   deployment agent's allowed-signers file; the promotion branch contains only
   the declarative record and no credentials.
7. Confirm the production poller verifies the promotion and deploys the exact
   digest through the restricted local executor.
8. Confirm poller state, container `RepoDigests`/image ID, and `/api/health`
   agree. Redundant local workflow watchers may be stopped, but never stop the
   poller or claim deployment complete from watcher state alone.

`deploy-production.yml` is a restricted break-glass path while the poller
completes its soak and rollback gates; it is not the normal release path.

Do not deploy an image from an earlier commit merely because it already exists.

## 8. Post-deployment verification

Record the following in the session or release report:

- merged commit SHA;
- release version;
- immutable image digest;
- CI, security, release, promotion, and poller evidence;
- health response;
- results of the fork acceptance checklist.

For UI/data changes, manually verify login, persisted data/uploads, Vacay,
Obsidian synchronization, and the PWA update path on the private production URL.
Vacay verification must include:

- a historical daily-note `假期` row before the first plan-table row;
- a mixed-category color/count check: PTO, 公共假期, and 病假 remain visually
  separate, with 病假 excluded from the beside-year total;
- future `PTO` and `公共假期` rows from the read-only `请假计划.md` table;
- same-date daily-note precedence; and
- a negative check that an unrelated Yearly Glance custom event (for example a
  flight) is not imported as PTO.

## Lessons from the v3.4.1 integration

- PR checks can pass while the main-branch security scan later blocks release;
  both must be monitored for the exact release commit.
- Focused tests did not expose strict locale parity or a missing Vitest virtual
  PWA module alias; full CI found both.
- Production environment approval cannot be completed by automation and must be
  performed by an authorized GitHub user.
- A successful deployment is not complete until the exact image digest and
  private production health response are recorded.
- The client coverage gate can outlast the release verifier timeout; wait for
  CI rather than pushing a no-op commit or promoting a mutable tag.
- The release artifact, signed promotion SHA, poller state, running
  `RepoDigests`, and health response form one evidence chain; record all of
  them together.
