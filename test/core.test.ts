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
    default: { allow: ["commit", "push"], ask: ["tag"], deny: ["reset"] },
    branches: {
      main: { allow: [], ask: ["commit"] },
    },
    repos: {
      "/repo": { allow: ["commit"], deny: ["push"] },
    },
  }

  test("falls back to default when no rule matches", () => {
    expect(resolvePolicy(config, "feature", "/other")).toEqual({
      allow: ["commit", "push"],
      ask: ["tag"],
      deny: ["reset"],
    })
  })

  test("branch rule replaces allow and ask, and unions deny with default", () => {
    expect(resolvePolicy(config, "main", "/other")).toEqual({
      allow: [],
      ask: ["commit"],
      deny: ["reset"],
    })
  })

  test("repo rule overrides the branch rule", () => {
    expect(resolvePolicy(config, "main", "/repo")).toEqual({
      allow: ["commit"],
      ask: ["tag"],
      deny: ["reset", "push"],
    })
  })

  test("ask falls back to the baseline when the rule omits it", () => {
    // The repo rule omits `ask`, so the baseline `ask` applies.
    expect(resolvePolicy(config, "main", "/repo").ask).toEqual(["tag"])
    // A rule that sets `ask` replaces the baseline.
    expect(resolvePolicy(config, "main", "/other").ask).toEqual(["commit"])
  })

  test("fail-closed when no config is present", () => {
    expect(resolvePolicy({}, "main", "/repo")).toEqual({ allow: [], ask: [], deny: [] })
  })
})

describe("decide", () => {
  test("allows an operation in allow and not in deny or ask", () => {
    expect(decide("commit", { allow: ["commit"], ask: [], deny: [] }).effect).toBe("allow")
  })

  test("asks for an operation in ask", () => {
    const decision = decide("commit", { allow: [], ask: ["commit"], deny: [] })
    expect(decision.effect).toBe("ask")
    expect(decision.message).toContain("commit")
  })

  test("deny wins over ask and allow", () => {
    const decision = decide("push", { allow: ["push"], ask: ["push"], deny: ["push"] })
    expect(decision.effect).toBe("deny")
    expect(decision.message).toContain("denied")
  })

  test("ask wins over allow", () => {
    expect(decide("commit", { allow: ["commit"], ask: ["commit"], deny: [] }).effect).toBe("ask")
  })

  test("denies an operation missing from every list", () => {
    const decision = decide("commit", { allow: [], ask: [], deny: [] })
    expect(decision.effect).toBe("deny")
    expect(decision.message).toContain("not allowed")
  })
})
