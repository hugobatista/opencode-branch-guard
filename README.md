# opencode-branch-guard

[![GitHub Tag](https://img.shields.io/github/v/tag/hugobatista/opencode-branch-guard?logo=github&label=latest)](https://go.hugobatista.com/gh/opencode-branch-guard/releases)
[![Lint](https://img.shields.io/github/actions/workflow/status/hugobatista/opencode-branch-guard/lint.yml?label=Lint)](https://go.hugobatista.com/gh/opencode-branch-guard/actions/workflows/lint.yml)
[![Test](https://img.shields.io/github/actions/workflow/status/hugobatista/opencode-branch-guard/test.yml?label=Test)](https://go.hugobatista.com/gh/opencode-branch-guard/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/opencode-branch-guard.svg)](https://www.npmjs.com/package/opencode-branch-guard)

OpenCode plugin. Blocks git mutations (`commit`, `push`, `merge`, `rebase`,
`reset`, …) based on the current branch or repository, so protected branches stay
clean. Deny a whole branch, allow a different policy per repository, and keep
read-only commands untouched.

> **Requires OpenCode V2.** OpenCode V2 changed the plugin API; V1 plugin
> implementations do not run in V2. This plugin is built against
> `@opencode/plugin` V2 only.

## What it does

- Intercepts the `shell` permission via `ctx.permission.hook("evaluate")` and
  returns `effect: "deny"` when a git mutation violates the resolved policy.
- Resolves the branch from `ctx.vcs.get().data.branch.current` — no subprocess,
  no `git` spawn.
- Resolves the policy hierarchically: `repos[<directory>]` overrides
  `branches[<branch>]`, which overrides `default`.
- Applies the same decision to every resource of a compound command, so
  `cd /tmp && git commit` is caught.
- Passes read-only commands (`status`, `log`, `diff`, `fetch`, …) and anything
  that is not a known git mutation.
- Fails closed: with no options, every git mutation is denied.

## Requirements

- **OpenCode V2.** The V2 release changed the plugin API; V1 plugin
  implementations do not run in V2.
- [Bun](https://bun.sh) to install dependencies (dev only).

## Install

```sh
opencode plugin add opencode-branch-guard
```

Or add the package to `opencode.jsonc` (project or
`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-branch-guard"]
}
```

With no options the plugin is **fail-closed**: it denies every git mutation.
Pass [options](#configuration) to allow the operations you want.

> This is a **server** plugin. Configure it in `opencode.json(c)`. The
> `cli.json` file is for terminal (TUI) plugins only.

### Install from source (local dev)

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/hugobatista/opencode-branch-guard.git ~/code/projects/opencode-branch-guard
   cd ~/code/projects/opencode-branch-guard
   bun install
   ```

2. Register the plugin in your `opencode.jsonc` with an absolute path to
   `src/index.ts`:

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": ["/home/your-user/code/projects/opencode-branch-guard/src/index.ts"]
   }
   ```

3. Restart OpenCode.

## Configuration

Pass options with the object form:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-branch-guard",
      "options": {
        "default": {
          "allow": ["add", "branch", "checkout", "commit", "push", "fetch", "merge", "pull", "rebase", "reset", "restore", "stash", "switch", "tag"],
          "deny": []
        },
        "branches": {
          "main": { "allow": [] },
          "master": { "allow": [] }
        }
      }
    }
  ]
}
```

### Options

| Option | Default | Description |
|---|---|---|
| `default` | none (fail-closed) | Baseline policy applied when no more specific rule matches. `allow` lists the permitted git operations; `deny` lists blocked ones. With no `default.allow`, every mutation is blocked. |
| `branches` | none | Policy keyed by exact branch name, resolved at command time from the VCS. A matching entry replaces the baseline `allow` and unions its `deny` with the baseline. |
| `repos` | none | Policy keyed by absolute location directory. Takes precedence over `branches` and `default`. |

A policy is `{ "allow": string[], "deny": string[] }`. Both fields are optional.

Recognized git operations: `add`, `branch`, `checkout`, `cherry-pick`, `clean`,
`commit`, `merge`, `mv`, `push`, `rebase`, `reset`, `restore`, `revert`, `rm`,
`stash`, `switch`, `tag`.

### Semantics

- **Fail-closed.** No config, or an empty resolved `allow`, blocks every git
  mutation.
- **Hierarchical.** `default` is the baseline. A `branches.<name>` entry
  overrides `allow` (replaces the baseline) and `deny` (unions with the
  baseline). A `repos.<directory>` entry overrides both.
- **`deny` wins.** An operation is allowed only if it is in the resolved `allow`
  and not in the resolved `deny`.
- **Exact branch match.** The branch is resolved at call time via
  `ctx.vcs.get()`. No globs.
- **Read-only commands pass.** `status`, `log`, `diff`, `fetch` and anything not
  in the mutation list are never blocked.

The example above gives `main`/`master` an empty `allow` (no mutations), while
every other branch inherits the permissive default.

### Per-repository override

Allow work in a single checkout even on a protected branch by keying it on the
location directory:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-branch-guard",
      "options": {
        "default": { "allow": ["commit", "push"] },
        "branches": { "main": { "allow": [] } },
        "repos": {
          "/home/you/code/projects/scratch": {
            "allow": ["add", "commit", "push", "reset", "stash", "switch"]
          }
        }
      }
    }
  ]
}
```

### Blocklist instead of allowlist

Use `deny` when you want a permissive baseline with a few hard blocks:

```jsonc
{
  "default": { "allow": ["commit", "push", "add", "checkout", "merge"], "deny": ["push"] }
}
```

`deny` wins over `allow`, so `push` is blocked even though it is listed.

## Limitations

The plugin inspects the shell command string, so it can be bypassed by:

- Git hidden behind a wrapper the scanner does not unwrap (`sudo git commit`,
  shell aliases, scripts that call git).
- Git invoked through a tool other than the shell tool (for example a
  subprocess started by a program the agent runs).
- Compound commands the scanner cannot split.

It is a guardrail against accidental mutations, not a security boundary.

## Verify

After configuring, restart OpenCode and try:

1. On `main`: ask the agent to run `git commit` — the command is denied with
   `Blocked: git commit is not allowed by config`.
2. On a feature branch: the same command is allowed.
3. `git status` and `git log` are always allowed.
4. On a directory listed in `repos`, the repository policy applies.

## Uninstall

```sh
opencode plugin remove opencode-branch-guard
```

Or remove the entry from `plugins` in your `opencode.jsonc` and restart
OpenCode.

## Development

```sh
bun install
bun run typecheck   # tsc --noEmit, strict
bun test            # unit (core logic) + functional (mocked plugin context)
bun run build       # dist/index.js + dist/index.d.ts (npm entrypoint)
```

- `src/core.ts` — pure logic: git operation parsing and policy resolution. No
  OpenCode imports. Fully unit-tested.
- `src/index.ts` — the plugin (`id: "branch-guard"`), a
  `Plugin.define({ id, setup })` from `@opencode/plugin`. It registers a
  `ctx.permission.hook("evaluate")` and reads the branch from `ctx.vcs.get()`.
- `scripts/build.ts` — bundles `src/index.ts` to `dist/index.js` with
  `@opencode/plugin` external, then emits declarations with `tsc`.

## Pre-release checklist

```sh
bun install
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

Inspect the pack list (`dist/`, `README.md`, `LICENSE` only). Scan for secrets
before `npm publish`.

## License

MIT — see [LICENSE](./LICENSE). Author: Hugo Batista
(<https://github.com/hugobatista>).
