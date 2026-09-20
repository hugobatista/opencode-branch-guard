import { Plugin } from "@opencode/plugin"
import { decide, gitOp, resolvePolicy, type Config } from "./core"

// Read the branch of the plugin's location. Returns undefined when the location
// is not a repository (or the VCS backend has no branch), so no branch rule
// applies.
async function currentBranch(ctx: Plugin.Context): Promise<string | undefined> {
  try {
    return (await ctx.vcs.get()).data.branch.current
  } catch {
    return undefined
  }
}

export default Plugin.define({
  id: "branch-guard",
  async setup(ctx) {
    const config = (ctx.options ?? {}) as Config

    await ctx.permission.hook("evaluate", async (event) => {
      // V2 names the shell action "shell"; ignore every other action.
      if (event.action !== "shell") return

      // Only pay for the VCS round-trip when the config has branch rules.
      const branch = config.branches ? await currentBranch(ctx) : undefined
      const policy = resolvePolicy(config, branch, ctx.location.directory)

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
