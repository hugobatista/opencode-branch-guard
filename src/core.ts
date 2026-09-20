// Pure branch-guard logic. No OpenCode imports, so it is fully unit-testable.

export const OPS = [
  "add",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "mv",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
] as const

export type GitOp = (typeof OPS)[number]

// Git global flags that consume the following token as their value.
const FLAG_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--exec-path",
  "--namespace",
  "--separate-git-dir",
  "--config-env",
])

export type BranchPolicy = {
  allow?: string[]
  ask?: string[]
  deny?: string[]
}

export type Config = {
  default?: BranchPolicy
  branches?: Record<string, BranchPolicy>
  repos?: Record<string, BranchPolicy>
}

export type ResolvedPolicy = {
  allow: string[]
  ask: string[]
  deny: string[]
}

export type Effect = "allow" | "ask" | "deny"

export type Decision = {
  effect: Effect
  message?: string
}

export function isGitOp(value: string): value is GitOp {
  return (OPS as readonly string[]).includes(value)
}

// Extract the git mutation from a shell command string. Returns null for
// non-git commands, git invocations without a known mutation, and read-only
// commands (`status`, `log`, `diff`, ...).
export function gitOp(cmd: string): GitOp | null {
  const tokens = cmd.trim().split(/\s+/).filter(Boolean)
  if (tokens[0] !== "git") return null

  let i = 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === undefined) return null
    if (!token.startsWith("-")) {
      return isGitOp(token) ? token : null
    }
    if (token.startsWith("--") && token.includes("=")) {
      i += 1
    } else if (FLAG_WITH_VALUE.has(token)) {
      i += 2
    } else {
      i += 1
    }
  }
  return null
}

// Resolve the effective policy for a command. `repos[directory]` overrides
// `branches[branch]`, which overrides `default`. A rule's `allow` and `ask`
// replace the baseline; its `deny` unions with the baseline. No resolved
// `allow` means no mutation is permitted (fail-closed).
export function resolvePolicy(
  config: Config,
  branch: string | undefined,
  directory: string | undefined,
): ResolvedPolicy {
  const base = config.default ?? {}
  const branchRule = branch !== undefined ? config.branches?.[branch] : undefined
  const repoRule = directory !== undefined ? config.repos?.[directory] : undefined
  const rule = repoRule ?? branchRule
  const allow = rule?.allow ?? base.allow ?? []
  const ask = rule?.ask ?? base.ask ?? []
  const deny = [...(base.deny ?? []), ...(rule?.deny ?? [])]
  return { allow, ask, deny }
}

// Resolve the effect for one git operation. Precedence is `deny > ask > allow`.
// An operation missing from every list is denied (fail-closed).
export function decide(op: string, policy: ResolvedPolicy): Decision {
  if (policy.deny.includes(op)) {
    return { effect: "deny", message: `Blocked: git ${op} is denied by config` }
  }
  if (policy.ask.includes(op)) {
    return { effect: "ask", message: `git ${op} requires approval by config` }
  }
  if (policy.allow.includes(op)) {
    return { effect: "allow" }
  }
  return { effect: "deny", message: `Blocked: git ${op} is not allowed by config` }
}
