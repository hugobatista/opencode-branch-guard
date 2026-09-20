import { describe, expect, test } from "bun:test"
import { decide, gitOp, resolvePolicy, type Config } from "../src/core"

describe("gitOp", () => {
  test("returns the mutation for a plain command", () => {
    expect(gitOp("git commit -m 'x'")).toBe("commit")
    expect(gitOp("git push origin main")).toBe("push")
  })

  test("returns null for non-git commands", () => {
    expect(gitOp("ls -la")).toBeNull()
    expect(gitOp("echo git commit")).toBeNull()
    expect(gitOp("")).toBeNull()
  })

  test("returns null for read-only commands", () => {
    expect(gitOp("git status")).toBeNull()
    expect(gitOp("git log --oneline")).toBeNull()
    expect(gitOp("git diff")).toBeNull()
  })

  test("skips global flags and their values", () => {
    expect(gitOp("git -C /tmp/repo commit -m x")).toBe("commit")
    expect(gitOp("git --git-dir=/tmp/repo/.git commit")).toBe("commit")
    expect(gitOp("git --git-dir /tmp/repo/.git commit")).toBe("commit")
    expect(gitOp("git -c core.hooksPath=/dev/null commit")).toBe("commit")
    expect(gitOp("git --no-pager commit")).toBe("commit")
  })

  test("returns null when git is invoked without a known mutation", () => {
    expect(gitOp("git")).toBeNull()
    expect(gitOp("git -C /tmp/repo")).toBeNull()
    expect(gitOp("git fetch")).toBeNull()
  })
})

describe("resolvePolicy", () => {
  const config: Config = {
    default: { allow: ["commit", "push"], deny: ["reset"] },
    branches: {
      main: { allow: [] },
    },
    repos: {
      "/repo": { allow: ["commit"], deny: ["push"] },
    },
  }

  test("falls back to default when no rule matches", () => {
    expect(resolvePolicy(config, "feature", "/other")).toEqual({
      allow: ["commit", "push"],
      deny: ["reset"],
    })
  })

  test("branch rule replaces allow and unions deny with default", () => {
    expect(resolvePolicy(config, "main", "/other")).toEqual({
      allow: [],
      deny: ["reset"],
    })
  })

  test("repo rule overrides the branch rule", () => {
    expect(resolvePolicy(config, "main", "/repo")).toEqual({
      allow: ["commit"],
      deny: ["reset", "push"],
    })
  })

  test("fail-closed when no config is present", () => {
    expect(resolvePolicy({}, "main", "/repo")).toEqual({ allow: [], deny: [] })
  })
})

describe("decide", () => {
  test("allows an operation in allow and not in deny", () => {
    expect(decide("commit", { allow: ["commit"], deny: [] }).allowed).toBe(true)
  })

  test("deny wins over allow", () => {
    const decision = decide("push", { allow: ["push"], deny: ["push"] })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toContain("denied")
  })

  test("denies an operation missing from allow", () => {
    const decision = decide("commit", { allow: [], deny: [] })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toContain("not allowed")
  })
})
