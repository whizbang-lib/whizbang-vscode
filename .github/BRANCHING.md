# Git Flow Branching Strategy

This repository follows Git Flow. Branch direction is enforced by CI.

## Branch Types

| Branch | Purpose | Merges Into |
|--------|---------|-------------|
| `main` | Production (triggers Marketplace publish on tag) | — |
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
5. When ready to release: create `release/x.y.z` branch from `develop`
6. Open PR from `release/x.y.z` to `main`
7. Merge to `main`, then tag `vx.y.z` to trigger Marketplace publish

## Publishing

Publishing to the VS Code Marketplace is triggered by pushing a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers the `publish.yml` workflow which builds, packages, publishes to the Marketplace, and creates a GitHub Release.
