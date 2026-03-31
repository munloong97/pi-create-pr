# pi-create-pr

A pi extension that adds a `/create-pr` command to create GitHub pull requests with AI-generated descriptions.

## Usage

```
/create-pr                    # Create PR against default base (auto-detects: main/master/develop/dev)
/create-pr develop            # Create PR against 'develop' branch
/create-pr --draft            # Create a draft PR
/create-pr main --draft       # Create a draft PR against 'main'
```

## What it does

1. ✅ Verifies GitHub CLI (`gh`) is installed and available
2. ✅ Detects your current branch and auto-detects base branch (main → master → develop → dev)
3. ✅ Checks for commits ahead of base
4. ✅ Prevents duplicate PRs (warns if PR already exists for this branch)
5. ✅ Warns about uncommitted changes
6. ✅ Warns if branch is behind base (optional rebase prompt)
7. ✅ Pushes the branch to origin
8. ✅ Gathers commit log and diff stats
9. ✅ Generates PR title + description using AI (via `ctx.llm`)
10. ✅ Creates the PR directly via `gh pr create`

## Requirements

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated
- Git repository with a remote named `origin`
