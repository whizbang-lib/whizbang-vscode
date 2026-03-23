# VSCode Extension: Build & Branching Alignment Guide

> **Context**: The docs repo (`whizbang-lib.github.io`) was recently aligned with Git Flow branching, CI/CD with notifications, dependabot, and frozen lockfile enforcement. This guide captures what was learned and what needs to be applied to the VSCode extension repo.

## Current State

- **Package manager**: pnpm (v9)
- **CI workflows**: build.yml, lint.yml, package.yml, publish.yml — all functional
- **Branching**: Has `main` and `develop` branches but no enforced Git Flow
- **Dependabot**: Not configured
- **Notifications**: None
- **Lockfile enforcement**: Not using `--frozen-lockfile` in CI

## What Needs to Be Done

### 1. Git Flow Enforcement

Add `.github/workflows/git-flow-check.yml` — copy from the docs repo and adapt.

Reference: `whizbang-lib.github.io/.github/workflows/git-flow-check.yml`

Key rules:
- `feature/*`, `feat/*`, `fix/*`, `chore/*`, `docs/*` etc. → `develop`
- `release/*` → `main`
- `hotfix/*` → `main` or `develop`

Also add `.github/BRANCHING.md` documenting the strategy.

**Important lesson learned**: Add `if: github.event_name == 'pull_request'` to the job — GitHub sometimes creates phantom push-triggered runs that show as failures even when the workflow only has `on: pull_request`.

### 2. Frozen Lockfile in CI

Update all workflows to use `pnpm install --frozen-lockfile` instead of bare `pnpm install`.

**Lesson learned**: When dependabot bumps individual packages, the lockfile can drift. If CI doesn't enforce `--frozen-lockfile`, broken dependency states slip through silently. When it *does* enforce it, dependabot PRs that produce stale lockfiles will fail CI — which is the correct behavior (forces a lockfile regeneration).

### 3. Dependabot Configuration

Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    target-branch: "develop"
    open-pull-requests-limit: 10
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    target-branch: "develop"
```

**Lesson learned**: Dependabot bumps packages individually. For tightly coupled packages (like `@angular/*`), this creates version mismatches. VSCode extension dependencies are less coupled, but watch for `@types/vscode` + `vscode` engine version alignment. Consider grouping related deps in dependabot config.

### 4. Pushover Notifications

Add the shared notification action and wire it into CI workflows.

Reference: `whizbang-lib.github.io/.github/actions/notify-pushover/action.yml`

Add notification jobs to:
- `build.yml` — on success/failure for push events
- `publish.yml` — on successful publish to marketplace

The docs repo uses `[DOCS]` prefix in notification titles. Use `[VSCODE]` here for clarity.

### 5. CODEOWNERS

Add `.github/CODEOWNERS` if not present.

### 6. Node.js 24 Migration

CI workflows using `actions/checkout@v4` will be forced to Node.js 24 starting June 2, 2026. The docs repo already shows deprecation warnings. Plan to update action versions across all repos.

## Lessons Learned from Docs Repo

1. **Don't merge dependabot PRs blindly** — Angular packages needed to stay on the same major version. Merging individual bumps across a tightly coupled package family caused build failures. Review dependency relationships before merging.

2. **Regenerate lockfiles after batch merges** — After merging multiple dependabot PRs, do a clean `rm -rf node_modules pnpm-lock.yaml && pnpm install` and commit the lockfile.

3. **History rewrites are expensive** — We had to `git filter-repo` to remove generated files that should have been gitignored from the start. For this repo, make sure `out/`, `*.vsix`, and any generated files are gitignored before they accumulate history.

4. **Release branches per Git Flow** — Use `release/*` branches for PRs into `main`. Don't merge `develop` → `main` directly.

5. **Phantom workflow runs** — GitHub Actions can create ghost runs for workflows triggered by events they don't subscribe to. Guard with explicit `if: github.event_name == '...'` conditions.

## Suggested Implementation Order

1. Add `.github/BRANCHING.md` and `git-flow-check.yml`
2. Add `--frozen-lockfile` to all CI install steps
3. Add `.github/dependabot.yml`
4. Add Pushover notification action + wire into workflows
5. Add `.github/CODEOWNERS`
6. Verify `out/` and `*.vsix` are properly gitignored (they are currently)
7. Test the full flow: feature branch → PR to develop → release branch → PR to main → publish via tag
