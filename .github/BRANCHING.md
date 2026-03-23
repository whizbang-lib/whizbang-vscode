# Git Flow Branching Strategy

This repository follows Git Flow. Branch direction is enforced by CI.

## Branch Types

| Branch | Purpose | Merges Into |
|--------|---------|-------------|
| `main` | Production (triggers Marketplace publish on merge) | — |
| `develop` | Integration branch | `main` (via release) |
| `feature/*`, `feat/*` | New features | `develop` |
| `fix/*` | Bug fixes | `develop` |
| `chore/*`, `docs/*`, `ci/*` | Maintenance | `develop` |
| `release/*` | Release preparation | `main` |
| `hotfix/*` | Urgent production fixes | `main` or `develop` |

## Allowed PR Directions

```
feature/*, feat/*, fix/*, chore/*, docs/*, ci/*,
refactor/*, test/*, perf/*, build/*, style/*  →  develop

release/*          →  main
hotfix/*           →  main OR develop
dependabot/*       →  develop
main               →  develop (sync after release)
develop            →  release/*
```

All other directions are blocked by the `git-flow-check` workflow.

## Workflow

1. Create feature branch from `develop`
2. Open PR targeting `develop`
3. CI runs build, lint, and package checks automatically
4. Merge to `develop`
5. When ready to release: run the **Start Release** workflow (see below)
6. Review and merge the auto-created release PR to `main`
7. Release workflow automatically tags, publishes to Marketplace, and syncs develop

## Publishing

Publishing is fully automated via the **Start Release** workflow:

1. Go to **Actions → Start Release → Run workflow**
2. Select release type: `major`, `minor`, `patch`, or `manual`
3. The workflow creates a `release/vX.Y.Z` branch, bumps `package.json`, and opens a PR to `main`
4. Review the PR and merge it
5. On merge, the **Release** workflow automatically:
   - Creates git tag `vX.Y.Z`
   - Builds and packages the VSIX
   - Publishes to the VS Code Marketplace
   - Creates a GitHub Release with the VSIX artifact
   - Syncs `main` back into `develop`
