/**
 * Create PR Extension
 *
 * Creates a GitHub pull request with an AI-generated description
 * based on the diff between the current branch and the base branch.
 *
 * Usage:
 * - `/create-pr`              - create PR against default base branch (main/master)
 * - `/create-pr <base>`       - create PR against a specific base branch
 * - `/create-pr --draft`      - create a draft PR
 * - `/create-pr <base> --draft` - create a draft PR against a specific base
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("create-pr", {
    description: "Create a GitHub PR with AI-generated description",
    getArgumentCompletions: (prefix) => {
      const options = ["--draft", "main", "master", "develop", "staging"];
      const filtered = options.filter((o) => o.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((o) => ({ value: o, label: o })) : null;
    },
    handler: async (args: string | undefined, ctx: ExtensionCommandContext) => {
      const tokens = (args?.trim() ?? "").split(/\s+/).filter(Boolean);
      const isDraft = tokens.includes("--draft");
      const baseBranch = tokens.find((t) => t !== "--draft") ?? "";

      // 1. Check we're in a git repo
      const gitCheck = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
      if (gitCheck.code !== 0) {
        ctx.ui.notify("Not inside a git repository", "error");
        return;
      }

      // 2. Get current branch
      const branchResult = await pi.exec("git", ["branch", "--show-current"]);
      const currentBranch = branchResult.stdout.trim();
      if (!currentBranch) {
        ctx.ui.notify("Could not determine current branch (detached HEAD?)", "error");
        return;
      }

      // 3. Detect base branch if not provided
      let base = baseBranch;
      if (!base) {
        const mainCheck = await pi.exec("git", ["rev-parse", "--verify", "main"], { timeout: 5000 });
        base = mainCheck.code === 0 ? "main" : "master";
      }

      // 4. Check there are commits ahead
      const logResult = await pi.exec("git", ["log", `${base}..${currentBranch}`, "--oneline"]);
      const commits = logResult.stdout.trim();
      if (!commits) {
        ctx.ui.notify(`No commits ahead of '${base}'. Nothing to PR.`, "warning");
        return;
      }

      // 5. Check for uncommitted changes
      const statusResult = await pi.exec("git", ["status", "--porcelain"]);
      if (statusResult.stdout.trim()) {
        const proceed = await ctx.ui.confirm(
          "Uncommitted changes",
          "You have uncommitted changes. Continue creating PR anyway?"
        );
        if (!proceed) return;
      }

      // 6. Push current branch
      ctx.ui.setStatus("create-pr", "Pushing branch...");
      const pushResult = await pi.exec("git", ["push", "-u", "origin", currentBranch]);
      if (pushResult.code !== 0) {
        ctx.ui.setStatus("create-pr", "");
        ctx.ui.notify(`Failed to push: ${pushResult.stderr.trim()}`, "error");
        return;
      }

      // 7. Get diff + commit log for description generation
      ctx.ui.setStatus("create-pr", "Generating PR description...");

      const diffResult = await pi.exec("git", ["diff", `${base}...${currentBranch}`, "--stat"]);
      const commitLog = await pi.exec("git", ["log", `${base}..${currentBranch}`, "--pretty=format:%s"]);

      const diffStat = diffResult.stdout.trim();
      const commitMessages = commitLog.stdout.trim();

      // 8. Derive PR title from branch name
      const prTitle = currentBranch
        .replace(/^(feature|fix|chore|docs|refactor|hotfix)\//i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      // 9. Ask LLM to generate description via sendUserMessage
      const draftFlag = isDraft ? " --draft" : "";

      pi.sendUserMessage(
        `Create a GitHub pull request for branch '${currentBranch}' against '${base}'.

Use the following information to write a concise PR description in markdown:

**Branch:** ${currentBranch}
**Base:** ${base}
**Suggested title:** ${prTitle}

**Commits:**
${commitMessages}

**Diff stat:**
${diffStat}

Instructions:
1. Write a clear PR title (use the suggested title or improve it)
2. Write a PR body with: Summary, Changes, and any relevant notes
3. Then run this exact command to create the PR:

\`\`\`
gh pr create --base ${base} --title "<your title>" --body "<your body>"${draftFlag}
\`\`\`

Do NOT ask me for confirmation — just generate the description and create the PR.`
      );

      ctx.ui.setStatus("create-pr", "");
    },
  });
}
