/**
 * Create PR Extension
 *
 * Creates a GitHub pull request with an AI-generated description
 * based on the diff between the current branch and the base branch.
 *
 * Usage:
 * - `/create-pr`              - create PR against default base branch (main/master/develop/dev)
 * - `/create-pr --open`       - open PR creation in browser for manual editing
 * - `/create-pr --draft`      - create a draft PR
 * - `/create-pr --draft --open` - create a draft PR and open in browser
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("create-pr", {
    description: "Create a GitHub PR with AI-generated description",
    getArgumentCompletions: (prefix) => {
      const options = ["--draft", "--open", "main", "master", "develop", "dev", "staging"];
      const filtered = options.filter((o) => o.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((o) => ({ value: o, label: o })) : null;
    },
    handler: async (args: string | undefined, ctx: ExtensionCommandContext) => {
      const tokens = (args?.trim() ?? "").split(/\s+/).filter(Boolean);
      const isDraft = tokens.includes("--draft");
      const isOpen = tokens.includes("--open");
      
      // Get base branch from non-flag tokens
      const baseBranch = tokens.find((t) => t !== "--draft" && t !== "--open") ?? "";

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

      // 10. Derive PR title from branch name
      const prTitle = currentBranch
        .replace(/^(feature|fix|chore|docs|refactor|hotfix)\//i, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      // 11. Generate PR description using LLM
      ctx.ui.setStatus("create-pr", "Generating PR description with AI...");
      
      // Get detailed commit log with full messages
      const commitLogResult = await pi.exec("git", [
        "log", 
        `${base}..${currentBranch}`, 
        "--pretty=format:%h %s%n%b%n---"
      ]);
      
      // Get full diff (truncated if too large)
      const diffResult = await pi.exec("git", [
        "diff", 
        `${base}...${currentBranch}`,
        "--stat"
      ]);
      
      const fileChanges = diffResult.stdout.trim();
      const commitMessages = commitLogResult.stdout.trim();

      // Create a prompt for the LLM
      const prompt = `## Generating a Pull Request Description

Please analyze the following commit history and file changes to generate a comprehensive, professional Pull Request description.

### Branch Information
- **Current Branch:** ${currentBranch}
- **Base Branch:** ${base}
- **Derived Title:** ${prTitle}

### Commit History
\`\`\`
${commitMessages}
\`\`\`

### Files Changed
\`\`\`
${fileChanges}
\`\`\`

Please generate a Pull Request description that includes:
1. A clear summary of what this PR does (2-3 sentences)
2. Key changes made (as bullet points)
3. Any important notes or considerations for reviewers

Format it in Markdown with proper headers and bullet points. Be concise but informative. Only return the PR description text, nothing else.`;

      // Send to LLM and wait for response
      let prDescription = "";
      try {
        pi.sendUserMessage(prompt);
        
        // Wait for the LLM to finish
        await ctx.waitForIdle();
        
        // Get the last assistant message (the generated description)
        const entries = ctx.sessionManager.getBranch();
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry.type === "message" && entry.message.role === "assistant") {
            const content = entry.message.content;
            if (Array.isArray(content)) {
              prDescription = content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("");
            } else if (typeof content === "string") {
              prDescription = content;
            }
            break;
          }
        }
        
        if (!prDescription.trim()) {
          throw new Error("No description generated");
        }
      } catch (error) {
        ctx.ui.setStatus("create-pr", "");
        ctx.ui.notify(`Failed to generate PR description: ${error}`, "error");
        return;
      }

      // 12. Create PR
      ctx.ui.setStatus("create-pr", "Creating PR...");
      
      const prArgs = [
        "pr", "create",
        "--base", base,
        "--title", prTitle,
        "--body", prDescription,
        ...(isDraft ? ["--draft"] : []),
        ...(isOpen ? ["--web"] : [])
      ];

      const prResult = await pi.exec("gh", prArgs);
      ctx.ui.setStatus("create-pr", "");

      if (prResult.code === 0) {
        if (isOpen) {
          ctx.ui.notify("✅ PR opened in browser for review", "success");
        } else {
          const urlMatch = prResult.stdout.match(/https:\/\/github\.com\/[^\s]+/);
          ctx.ui.notify(urlMatch ? `✅ PR created: ${urlMatch[0]}` : "✅ PR created successfully!", "success");
        }
      } else {
        ctx.ui.notify(`Failed to create PR: ${prResult.stderr.trim()}`, "error");
      }
    },
  });
}
