import { describe, expect, test } from "bun:test"
import plugin from "../src/index"
import type { Config } from "../src/core"

type Evaluation = {
  action: string
  resources: string[]
  effect: "allow" | "ask" | "deny"
  message?: string
}

const FLUSH = { dispose: async () => {} }

type HarnessOptions = {
  branch?: string
  directory?: string
}

async function createHarness(config: Config, options: HarnessOptions = {}) {
  const evaluations: Array<(event: Evaluation) => Promise<void> | void> = []

  const ctx = {
    options: config,
    location: { directory: options.directory ?? "/project" },
    permission: {
      hook: async (name: string, callback: (event: Evaluation) => Promise<void> | void) => {
        if (name === "evaluate") evaluations.push(callback)
        return FLUSH
      },
    },
    vcs: {
      get: async () => ({ data: { branch: { current: options.branch } } }),
    },
  }

  await plugin.setup(ctx as never)

  return {
    async evaluate(action: string, resources: string[]): Promise<Evaluation> {
      const event: Evaluation = { action, resources, effect: "allow" }
      for (const callback of evaluations) await callback(event)
      return event
    },
    registered: evaluations.length,
  }
}

const CONFIG: Config = {
  default: { allow: ["commit", "push"] },
  branches: { main: { allow: [] } },
  repos: { "/release": { allow: [] } },
}

describe("branch-guard plugin", () => {
  test("registers one evaluate hook", async () => {
    const harness = await createHarness(CONFIG)
    expect(harness.registered).toBe(1)
  })

  test("ignores non-shell actions", async () => {
    const harness = await createHarness(CONFIG, { branch: "main" })
    const event = await harness.evaluate("read", ["git commit"])
    expect(event.effect).toBe("allow")
  })

  test("blocks a denied mutation on a protected branch", async () => {
    const harness = await createHarness(CONFIG, { branch: "main" })
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("deny")
    expect(event.message).toContain("commit")
  })

  test("allows a permitted mutation on a feature branch", async () => {
    const harness = await createHarness(CONFIG, { branch: "feature/x" })
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("allow")
  })

  test("passes read-only commands", async () => {
    const harness = await createHarness(CONFIG, { branch: "main" })
    const event = await harness.evaluate("shell", ["git status", "git log"])
    expect(event.effect).toBe("allow")
  })

  test("the repo override wins over the branch rule", async () => {
    const harness = await createHarness(CONFIG, { branch: "feature/x", directory: "/release" })
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("deny")
  })

  test("denies every mutation when fail-closed with no options", async () => {
    const harness = await createHarness({}, { branch: "feature/x" })
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("deny")
  })

  test("checks every resource of a compound command", async () => {
    const harness = await createHarness(CONFIG, { branch: "main" })
    const event = await harness.evaluate("shell", ["cd /tmp", "git commit -m x"])
    expect(event.effect).toBe("deny")
  })
})
