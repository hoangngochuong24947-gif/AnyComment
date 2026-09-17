# Agents Guide for AnyComment

This file guides agents and engineers working on the AnyComment codebase.

## Engineering Invariants
- Runtime must be pure TypeScript; zero native C++ addons (`better-sqlite3` etc.) to guarantee 100% portability across VS Code platforms.
- Bundle using esbuild to a single file under `dist/extension.js`.
- Always prefer VS Code native APIs (`vscode.lm`, `context.secrets`, `context.globalStorageUri`).

## Agent skills

### Issue tracker

Local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout with CONTEXT.md at repo root and ADRs under docs/adr/. See `docs/agents/domain.md`.
