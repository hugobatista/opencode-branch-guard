# opencode-branch-guard

[![GitHub Tag](https://img.shields.io/github/v/tag/hugobatista/opencode-branch-guard?logo=github&label=latest)](https://go.hugobatista.com/gh/opencode-branch-guard/releases)
[![Lint](https://img.shields.io/github/actions/workflow/status/hugobatista/opencode-branch-guard/lint.yml?label=Lint)](https://go.hugobatista.com/gh/opencode-branch-guard/actions/workflows/lint.yml)
[![Test](https://img.shields.io/github/actions/workflow/status/hugobatista/opencode-branch-guard/test.yml?label=Test)](https://go.hugobatista.com/gh/opencode-branch-guard/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/opencode-branch-guard.svg)](https://www.npmjs.com/package/opencode-branch-guard)

OpenCode plugin. Controls git mutations (`commit`, `push`, `merge`, `rebase`,
`reset`, …) based on the current branch or repository, so protected branches
stay clean. Allow an operation, ask the user for approval, or deny it. Deny a
whole branch, allow a different policy per repository, and keep read-only
commands untouched.

> **Requires OpenCode V2.** OpenCode V2 changed the plugin API; V1 plugin
> implementations do not run in V2. This plugin is built against
> `@opencode/plugin` V2 only.

## Motivation

OpenCode V2 already ships permissions with `allow`, `ask`, and `deny`. You can
write `{ "action": "shell", "resource": "git push *", "effect": "deny" }`. Those
rules are static: they match the command text. They cannot see the current
branch or the repository.

The problem: `git commit` has the same text on `main` and on `feat/x`. A static
rule cannot allow it on `feat/x` and ask on `main`. To protect `main`, you must
ask or deny `git commit` everywhere, including feature branches.

This plugin adds the missing input: the VCS state at command time. It resolves
the branch and the checkout directory, then decides per git operation.

### Differences from the built-in `ask`

| Aspect | Built-in permissions (V2) | branch-guard |
|---|---|---|
| Decision input | Command text pattern | Branch + directory + git operation |
| When decided | Config load (static) | Command time (dynamic) |
| Git awareness | None; raw shell patterns | Recognizes git mutations |
| Branch scope | None | Per exact branch name |
| Repository scope | None | Per checkout directory |
| Default | Permissive (`allow`); `ask` only where configured | Deny (fail-closed); unlisted mutation is blocked |
| Read-only commands | Need an explicit `allow` pattern | Pass automatically |
| Compound commands | Scanner splits into command resources | Parses the git op; aggregates `deny > ask > allow` |
| Persistence | "Allow always" saves project `allow` rules | Config only |

### When to use which

They compose. The built-in rules run first, and the plugin hooks into the
resolution:

- **Use built-in `deny` for absolute blocks.** A configured `deny` is final and
  the plugin never sees it. Example: block `git push` in every repository.
- **Use built-in `allow`/`ask` for tool-level rules** that do not depend on the
  branch, such as allowing `git status`.
- **Use the plugin for branch- and repository-aware policy** — the case the
  built-in rules cannot express.

The plugin escalates but never downgrades. If the core resolved `ask`, the
plugin keeps `ask`. See [About `ask`](#about-ask) for the interaction details.

## What it does

- Intercepts the `shell` permission via `ctx.permission.hook("evaluate")` and
  returns `effect: "allow" | "ask" | "deny"` when a git mutation matches the
  resolved policy.
- Resolves the branch with `git -C <directory> branch --show-current`; the
  directory comes from the session (`ctx.session.get().location.directory`), not
  the plugin instance.
- Resolves the policy hierarchically: `repos[<directory>]` overrides
  `branches[<branch>]`, which overrides `default`.
- Applies the same decision to every resource of a compound command, so
  `cd /tmp && git commit` is caught. Precedence across resources is
  `deny > ask > allow`.
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
Pass [options](#configuration) to allow or ask for the operations you want.

> This is a **server** plugin. Configure it in `opencode.json(c)`. The
> `cli.json` file is for terminal (TUI) plugins only.

### Install from source (local dev)

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/hugobatista/opencode-branch-guard.git ~/code/projects/opencode-branch-guard
   cd ~/code/projects/opencode-branch-guard
   bun install
   ```

2. Register the plugin in your `opencode.jsonc` with an absolute path to the
   `src` directory (a local plugin directory must contain `index.ts` at its
   root):

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": ["/home/your-user/code/projects/opencode-branch-guard/src"]
   }
   ```

   To pass [options](#configuration) with a local path, use the object form and
   set `package` to the path:

   ```jsonc
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       {
         "package": "/home/your-user/code/projects/opencode-branch-guard/src",
         "options": {
           "default": { "allow": ["commit", "push"] },
           "branches": {
             "main": { "allow": [], "ask": ["commit"] }
           }
         }
       }
     ]
   }
   ```

3. Restart OpenCode.

## Configuration

Pass options with the object form. The plugin is configured under `options`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-branch-guard",
      "options": {
        "default": {
          "allow": ["add", "branch", "checkout", "commit", "push", "fetch", "merge", "pull", "rebase", "reset", "restore", "stash", "switch", "tag"],
          "ask": [],
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

### Policy shape

A policy is `{ "allow": string[], "ask": string[], "deny": string[] }`. Every
field is optional and holds a list of git operations.

| Effect | Result |
|---|---|
| `allow` | The operation runs without prompting. |
| `ask` | The client asks the user to approve the operation. |
| `deny` | The operation is blocked. The message explains why. |

An operation missing from every list is denied. This keeps the plugin
fail-closed.

### Options

| Option | Default | Description |
|---|---|---|
| `default` | none (fail-closed) | Baseline policy applied when no more specific rule matches. Any mutation missing from the resolved `allow` and `ask` is denied. |
| `branches` | none | Policy keyed by exact branch name, resolved at command time from the VCS. |
| `repos` | none | Policy keyed by absolute location directory. Takes precedence over `branches` and `default`. |

### Effects and precedence

Precedence is **`deny > ask > allow`**:

1. If the operation is in `deny`, it is denied. This wins over every other list.
2. Otherwise, if it is in `ask`, the client asks the user.
3. Otherwise, if it is in `allow`, it runs.
4. Otherwise, it is denied (fail-closed).

An operation listed in both `ask` and `allow` is asked. `deny` always wins.

When OpenCode checks a compound command, the plugin aggregates every resource
with the same precedence: one `deny` blocks the command, otherwise one `ask`
escalates it, otherwise it is allowed.

### How a policy is resolved

For a command on branch `B` in directory `D`:

1. `base` is `default`.
2. `rule` is `repos[D]` if present, otherwise `branches[B]`, otherwise nothing.
3. `allow` is `rule.allow`, or `base.allow`, or `[]`.
4. `ask` is `rule.ask`, or `base.ask`, or `[]`.
5. `deny` is `base.deny` followed by `rule.deny`.

`allow` and `ask` **replace** the baseline. `deny` **unions** with the baseline.
This means a specific rule that omits `ask` inherits the baseline `ask`, and a
rule that sets `ask` replaces it.

Because `deny` only unions with the baseline, a `repos` rule does not inherit
the `deny` of the matching `branches` rule. Repeat the operation in the `repos`
rule if you need it there.

### Recognized git operations

`add`, `branch`, `checkout`, `cherry-pick`, `clean`, `commit`, `merge`, `mv`,
`push`, `rebase`, `reset`, `restore`, `revert`, `rm`, `stash`, `switch`, `tag`.

Anything not in this list is treated as read-only and passes. The branch is
matched exactly with `git branch --show-current`. There are no globs.

### Examples

Each example shows the `options` object. Wrap it in the `plugins` object form
shown in [Configuration](#configuration).

#### Common recipes

| Goal | Use |
|---|---|
| Allow work on normal branches, ask on protected branches | `default.allow` plus `branches.<name>.ask` |
| Block every mutation on protected branches | `branches.<name>: { "allow": [] }` |
| Ask for every mutation | `default: { "ask": [...] }` |
| Block one operation everywhere | `default: { "deny": ["push"] }` |
| Different policy for one checkout | `repos: { "/path": { ... } }` |

#### 1. Allow on normal branches, ask on protected branches

```jsonc
{
  "default": {
    "allow": ["add", "checkout", "switch", "commit", "merge", "push", "rebase", "stash"]
  },
  "branches": {
    "main": {
      "allow": [],
      "ask": ["add", "checkout", "switch", "commit", "merge", "push", "rebase", "stash"]
    },
    "master": {
      "allow": [],
      "ask": ["add", "checkout", "switch", "commit", "merge", "push", "rebase", "stash"]
    }
  }
}
```

| Command | Feature branch | `main` / `master` |
|---|---|---|
| `git commit` | `allow` | `ask` |
| `git push` | `allow` | `ask` |
| `git switch` | `allow` | `ask` |
| `git reset` | `deny` | `deny` |
| `git tag` | `deny` | `deny` |
| `git status` | `allow` | `allow` |

`allow` and `ask` replace the baseline. On `main`, `allow` is empty and `ask`
lists the operations, so the listed ones ask. Anything else is denied.

#### 2. Block every mutation on protected branches

```jsonc
{
  "default": { "allow": ["commit", "push"] },
  "branches": {
    "main": { "allow": [] },
    "master": { "allow": [] }
  }
}
```

| Command | Feature branch | `main` / `master` |
|---|---|---|
| `git commit` | `allow` | `deny` |
| `git push` | `allow` | `deny` |
| `git status` | `allow` | `allow` |

An empty `allow` with no `ask` denies every mutation.

#### 3. Ask for every mutation

```jsonc
{
  "default": {
    "ask": ["add", "branch", "checkout", "cherry-pick", "clean", "commit", "merge", "mv", "push", "rebase", "reset", "restore", "revert", "rm", "stash", "switch", "tag"]
  }
}
```

Every mutation asks on every branch. Read-only commands pass. Nothing is blocked,
so the user decides.

#### 4. Ask on `main`, hard-deny `push`

```jsonc
{
  "default": { "allow": ["commit", "push"] },
  "branches": {
    "main": {
      "allow": [],
      "ask": ["commit"],
      "deny": ["push"]
    }
  }
}
```

| Command | Feature branch | `main` |
|---|---|---|
| `git commit` | `allow` | `ask` |
| `git push` | `allow` | `deny` |
| `git merge` | `deny` | `deny` |

On `main`, `commit` asks, `push` is denied, and `merge` is denied because it is
missing from every list.

#### 5. Block `push` everywhere

```jsonc
{
  "default": {
    "allow": ["add", "checkout", "switch", "commit", "merge", "rebase", "stash"],
    "deny": ["push"]
  }
}
```

`deny` wins over `allow`. `push` is blocked on every branch, even though the
other mutations are allowed.

#### 6. Allow only a small set of operations

```jsonc
{
  "default": { "allow": ["commit", "push"] }
}
```

Only `commit` and `push` are permitted. Every other mutation is denied on every
branch. This is the strictest permissive form.

#### 7. Protect a release branch

```jsonc
{
  "default": { "allow": ["commit", "push", "merge"] },
  "branches": {
    "release": {
      "allow": [],
      "ask": ["merge", "tag"],
      "deny": ["push", "reset", "clean"]
    }
  }
}
```

On the branch named exactly `release`: `merge` and `tag` ask, `push`, `reset`,
and `clean` are denied, and everything else is denied. Branch names match
exactly. There are no globs.

#### 8. Per-repository override

Allow work in a single checkout even on a protected branch by keying it on the
location directory:

```jsonc
{
  "default": { "allow": ["commit", "push"] },
  "branches": {
    "main": { "allow": [], "ask": ["commit"], "deny": ["push"] }
  },
  "repos": {
    "/home/you/code/projects/scratch": {
      "allow": ["add", "commit", "push", "reset", "stash", "switch"]
    }
  }
}
```

In `/home/you/code/projects/scratch` the repo rule replaces the branch `allow`
and `ask`, so `commit` runs without prompting. The repo rule omits `deny`, so it
inherits only `default.deny` (empty here), not the branch `deny`.

#### 9. Compound commands

```jsonc
{
  "default": { "allow": ["add", "commit"], "deny": ["push"] }
}
```

| Command | Result |
|---|---|
| `git add . && git commit -m x` | `allow` (both allowed) |
| `git add . && git push` | `deny` (one resource denied) |
| `git add . && git reset` | `deny` (one resource not allowed) |

The plugin applies the policy to every resource of the command. Precedence is
`deny > ask > allow`.

#### 10. Effect precedence

```jsonc
{
  "default": { "allow": ["commit"], "ask": ["commit"], "deny": [] }
}
```

`commit` is in both `allow` and `ask`, so it asks. `ask` wins over `allow`.

```jsonc
{
  "default": { "allow": ["commit"], "ask": ["commit"], "deny": ["commit"] }
}
```

Adding `commit` to `deny` blocks it. `deny` wins over everything.

## Limitations

The plugin inspects the shell command string, so it can be bypassed by:

- Git hidden behind a wrapper the scanner does not unwrap (`sudo git commit`,
  shell aliases, scripts that call git).
- Git invoked through a tool other than the shell tool (for example a
  subprocess started by a program the agent runs).
- Compound commands the scanner cannot split.

Also note that `branch` is treated as a mutation, so `git branch` and
`git branch --show-current` are blocked or asked on a protected branch. Use
`git rev-parse --abbrev-ref HEAD` if you need a read-only branch check there.

### About `ask`

The `ask` effect sends the operation to the OpenCode permission prompt. It has
these limits:

- **An explicit `deny` in your own `permissions` config is final.** The plugin
  hook runs only for `allow` and `ask` decisions, so a `deny` rule in
  `opencode.json(c)` blocks the command before the plugin sees it.
- **Non-interactive clients decide how to handle `ask`.** A run without a user
  (for example CI) may reject or stall. Keep `deny` for those environments.
- **"Allow always" may not stick.** Approving always saves a durable `allow`
  rule, but the plugin hook still runs and can escalate the command to `ask`
  again. Use `allow` in the plugin options for a permanent decision.
- **The plugin never downgrades.** If the core resolved an `ask` from your
  config, the plugin does not turn it into `allow`.

It is a guardrail against accidental mutations, not a security boundary.

## Verify

After configuring, restart OpenCode and try:

1. On `main` with `{ "allow": [] }`: ask the agent to run `git commit` — the
   command is denied with `Blocked: git commit is not allowed by config`.
2. On `main` with `{ "allow": [], "ask": ["commit"] }`: the same command opens a
   permission prompt.
3. On a feature branch: the same command is allowed.
4. `git status` and `git log` are always allowed.
5. On a directory listed in `repos`, the repository policy applies.
6. With `{ "allow": [], "ask": ["commit"], "deny": ["push"] }` on `main`:
   `git push` is denied, and `git commit` asks.

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

- `src/core.ts` — pure logic: git operation parsing, policy resolution, and the
  `allow`/`ask`/`deny` decision. No OpenCode imports. Fully unit-tested.
- `src/index.ts` — the plugin (`id: "branch-guard"`), a
  `Plugin.define({ id, setup })` from `@opencode/plugin`. It registers a
  `ctx.permission.hook("evaluate")`, resolves the session directory, and reads
  the branch with `git branch --show-current`.
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
