# Repository Instructions

## Working directory

- Work from `D:\DISCORD BOT\رفيق الروح`.
- Read this file and `CODEX_HANDOFF.md` completely before making changes.
- Inspect `git status` and `git diff` before starting work.

## Preserve existing work

- The working tree may contain intentional, unfinished changes from the user or a previous agent.
- Preserve all existing modifications, deletions, and untracked files.
- Do not revert, overwrite, discard, stage, or otherwise alter unrelated changes.
- Do not run destructive Git commands.
- Do not commit, push, deploy, or register Discord commands without the user's explicit approval.

## Project workflow

- This is a TypeScript Discord bot.
- Keep command behavior and user-facing Arabic text consistent with the surrounding code.
- Make focused changes and avoid unrelated cleanup or formatting churn.
- Use `npm.cmd run build` to validate TypeScript changes on Windows.
- Update `CODEX_HANDOFF.md` before finishing a substantial work session so the next agent can continue safely.

## Handoff discipline

- Treat the `Current state` and `Completed work` sections in `CODEX_HANDOFF.md` as context, not as permission to repeat or discard work.
- Continue from `Next tasks` unless the user gives a newer instruction.
- Record files changed, validation performed, remaining risks, and concrete next steps.
