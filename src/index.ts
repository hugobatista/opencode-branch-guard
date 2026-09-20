import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"
import { decide, gitOp, resolvePolicy, type Config } from "./core"

const execFileAsync = promisify(execFile)

// `ctx.vcs.get()` can return a stale or empty branch, so read it from git
// directly. Returns undefined outside a repository.
async function currentBranch(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", directory, "branch", "--show-current"],
      { timeout: 3000, windowsHide: true },
    )
    const branch = stdout.trim()
    return branch.length > 0 ? branch : undefined
  } catch {
    return undefined
  }
}

// The plugin context's location is not necessarily the session's repository, and
// the permission event does not carry a directory. Resolve it from the session.
async function sessionDirectory(ctx: Plugin.Context, sessionID: string): Promise<string | undefined> {
  try {
    return (await ctx.session.get({ sessionID })).location.directory
  } catch {
    return undefined
  }
}

export default Plugin.define({
  id: "branch-guard",
  async setup(ctx) {
    const config = (ctx.options ?? {}) as Config
    const directories = new Map<string, string | null>()

    await ctx.permission.hook("evaluate", async (event) => {
      // V2 names the shell action "shell"; ignore every other action.
      if (event.action !== "shell") return

      let directory: string | undefined
      if (config.branches || config.repos) {
        const cached = directories.get(event.sessionID)
        if (cached !== undefined) {
          directory = cached ?? undefined
        } else {
          directory = await sessionDirectory(ctx, event.sessionID)
          directories.set(event.sessionID, directory ?? null)
        }
      }

      const branch = config.branches
        ? await currentBranch(directory ?? ctx.location.directory)
        : undefined
      const policy = resolvePolicy(config, branch, directory)

      for (const resource of event.resources) {
        const op = gitOp(resource)
        if (op === null) continue
        const decision = decide(op, policy)
        if (!decision.allowed) {
          event.effect = "deny"
          event.message = decision.message
          return
        }
      }
    })
  },
})
