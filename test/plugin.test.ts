import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/index"
import type { Config } from "../src/core"

type Evaluation = {
  action: string
  sessionID: string
  resources: string[]
  effect: "allow" | "ask" | "deny"
  message?: string
}

const SESSION = "ses_test"

function makeRepo(branch: string): string {
  const directory = mkdtempSync(join(tmpdir(), "branch-guard-test-"))
  execFileSync("git", ["init", "-b", branch, directory])
  return directory
}

const MAIN_REPO = makeRepo("main")
const FEATURE_REPO = makeRepo("feature/x")

afterAll(() => {
  rmSync(MAIN_REPO, { recursive: true, force: true })
  rmSync(FEATURE_REPO, { recursive: true, force: true })
})

async function createHarness(config: Config, directory: string) {
  const evaluations: Array<(event: Evaluation) => Promise<void> | void> = []
  const fallback = { location: { directory } }

  const ctx = {
    options: config,
    location: { directory },
    session: {
      get: async () => fallback,
    },
    permission: {
      hook: async (name: string, callback: (event: Evaluation) => Promise<void> | void) => {
        if (name === "evaluate") evaluations.push(callback)
        return { dispose: async () => {} }
      },
    },
  }

  await plugin.setup(ctx as never)

  return {
    registered: evaluations.length,
    async evaluate(action: string, resources: string[]): Promise<Evaluation> {
      const event: Evaluation = { action, sessionID: SESSION, resources, effect: "allow" }
      for (const callback of evaluations) await callback(event)
      return event
    },
  }
}

describe("branch-guard plugin", () => {
  const base: Config = {
    default: { allow: ["commit", "push"] },
    branches: { main: { allow: [] } },
  }

  test("registers one evaluate hook", async () => {
    const harness = await createHarness(base, FEATURE_REPO)
    expect(harness.registered).toBe(1)
  })

  test("ignores non-shell actions", async () => {
    const harness = await createHarness(base, MAIN_REPO)
    const event = await harness.evaluate("read", ["git commit"])
    expect(event.effect).toBe("allow")
  })

  test("blocks a denied mutation on a protected branch", async () => {
    const harness = await createHarness(base, MAIN_REPO)
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("deny")
    expect(event.message).toContain("commit")
  })

  test("allows a permitted mutation on a feature branch", async () => {
    const harness = await createHarness(base, FEATURE_REPO)
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("allow")
  })

  test("passes read-only commands", async () => {
    const harness = await createHarness(base, MAIN_REPO)
    const event = await harness.evaluate("shell", ["git status", "git log"])
    expect(event.effect).toBe("allow")
  })

  test("the repo override wins over the branch rule", async () => {
    const config: Config = {
      default: { allow: ["push"] },
      branches: { main: { allow: [] } },
      repos: { [MAIN_REPO]: { allow: ["commit"] } },
    }
    const harness = await createHarness(config, MAIN_REPO)
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("allow")
  })

  test("denies every mutation when fail-closed with no options", async () => {
    const harness = await createHarness({}, FEATURE_REPO)
    const event = await harness.evaluate("shell", ["git commit -m x"])
    expect(event.effect).toBe("deny")
  })

  test("checks every resource of a compound command", async () => {
    const harness = await createHarness(base, MAIN_REPO)
    const event = await harness.evaluate("shell", ["cd /tmp", "git commit -m x"])
    expect(event.effect).toBe("deny")
  })
})
