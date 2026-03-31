/**
 * Create PR Extension
 *
 * Creates a GitHub pull request with an AI-generated description
 * based on the diff between the current branch and the base branch.
 *
 * Usage:
 * - `/create-pr`              - create PR against default base branch (main/master/develop/dev)
 * - `/create-pr <base>`       - create PR against a specific base branch
 * - `/create-pr --draft`      - create a draft PR
 * - `/create-pr <base> --draft` - create a draft PR against a specific base
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("create-pr", {
    description: "Create a GitHub PR with AI-generated description",
    getArgumentCompletions: (prefix) => {
      const options = ["--draft", "main", "master", "develop", "dev", "staging"];
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

      // 2. Verify gh CLI is installed
      const ghCheck = await pi.exec("gh", ["--version"]);
      if (ghCheck.code !== 0) {
        ctx.ui.notify("GitHub CLI (gh) not found. Install from https://cli.github.com/", "error");
        return;
      }

      // 3. Get current branch
      const branchResult = await pi.exec("git", ["branch", "--show-current"]);
      const currentBranch = branchResult.stdout.trim();
      if (!currentBranch) {
        ctx.ui.notify("Could not determine current branch (detached HEAD?)", "error");
        return;
      }

      // 4. Detect base branch if not provided (try main, master, develop, dev)
      let base = baseBranch;
      if (!base) {
        const possibleBases = ["main", "master", "develop", "dev"];
        for (const b of possibleBases) {
          const check = await pi.exec("git", ["rev-parse", "--verify", b], { timeout: 5000 });
          if (check.code === 0) {
            base = b;
            break;
          }
        }
        if (!base) base = "main"; // fallback
      }

      // 5. Check there are commits ahead
      const logResult = await pi.exec("git", ["log", `${base}..${currentBranch}`, "--oneline"]);
      const commits = logResult.stdout.trim();
      if (!commits) {
        ctx.ui.notify(`No commits ahead of '${base}'. Nothing to PR.`, "warning");
        return;
      }

      // 6. Check if PR already exists
      const existingPR = await pi.exec("gh", ["pr", "view", currentBranch, "--json", "url"]);
      if (existingPR.code === 0) {
        const url = JSON.parse(existingPR.stdout).url;
        ctx.ui.notify(`PR already exists: ${url}`, "warning");
        return;
      }

      // 7. Check for uncommitted changes
      const statusResult = await pi.exec("git", ["status", "--porcelain"]);
      if (statusResult.stdout.trim()) {
        const proceed = await ctx.ui.confirm(
          "Uncommitted changes",
          "You have uncommitted changes. Continue creating PR anyway?"
        );
        if (!proceed) return;
      }

      // 8. Check if branch is behind base (optional rebase)
      const behindCheck = await pi.exec("git", ["rev-list", "--count", `${currentBranch}..${base}`]);
      const behindCount = parseInt(behindCheck.stdout.trim(), 10);
      if (behindCount > 0) {
        const proceed = await ctx.ui.confirm(
          "Branch is behind",
          `${behindCount} commits behind '${base}'. Continue without rebasing?`
        );
        if (!proceed) return;
      }

      // 9. Push current branch
      ctx.ui.setStatus("create-pr", "Pushing branch...");
      const pushResult = await pi.exec("git", ["push", "-u", "origin", currentBranch]);
      if (pushResult.code !== 0) {
        ctx.ui.setStatus("create-pr", "");
        ctx.ui.notify(`Failed to push: ${pushResult.stderr.trim()}`, "error");
        return;
      }

      // 10. Get diff + commit log for description generation
      ctx.ui.setStatus("create-pr", "Generating PR description...");

      const diffResult = await pi.exec("git", ["diff", `${base}...${currentBranch}`, "--stat"]);
      const commitLog = await pi.exec("git", ["log", `${base}..${currentBranch}`, "--pretty=format:%s"]);

      const diffStat = diffResult.stdout.trim();
      const commitMessages = commitLog.stdout.trim();

      // 11. Derive PR title from branch name
      const prTitle = currentBranch
        .replace(/^(feature|fix|chore|docs|refactor|hotfix)\//i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      // 12. Generate description using LLM
      let description: string;
      try {
        const llmResponse = await ctx.llm.complete(
          `Write a concise GitHub PR description in markdown format.

**Title:** ${prTitle}
**Branch:** ${currentBranch}
**Base:** ${base}

**Commits:**
${commitMessages}

**Changes:**
${diffStat}

Write a brief summary (1-2 sentences), then list the key changes in bullet points.`
        );
        description = llmResponse.trim();
      } catch {
        // Fallback to simple description
        description = `## Summary\n\nPR for ${currentBranch}\n\n## Changes\n\n${commitMessages.split('\n').map(c => `- ${c}`).join('\n')}`;
      }

      // 13. Create PR directly using gh CLI
      ctx.ui.setStatus("create-pr", "Creating PR...");
      const prArgs = [
        "pr", "create",
        "--base", base,
        "--title", prTitle,
        "--body", description,
        ...(isDraft ? ["--draft"] : [])
      ];

      const prResult = await pi.exec("gh", prArgs);
      ctx.ui.setStatus("create-pr", "");

      if (prResult.code === 0) {
        const urlMatch = prResult.stdout.match(/https:\/\/github\.com\/[^\s]+/);
        ctx.ui.notify(urlMatch ? `✅ PR created: ${urlMatch[0]}` : "✅ PR created successfully!", "success");
      } else {
        ctx.ui.notify(`Failed to create PR: ${prResult.stderr.trim()}`, "error");
      }
    },
  });
}
