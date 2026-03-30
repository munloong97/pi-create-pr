# pi-create-pr

A pi extension that adds a `/create-pr` command to create GitHub pull requests with AI-generated descriptions.

## Usage

```
/create-pr              # Create PR against default base (main/master)
/create-pr develop      # Create PR against 'develop' branch
/create-pr --draft      # Create a draft PR
/create-pr main --draft # Create a draft PR against 'main'
```

## What it does

1. Detects your current branch and base branch
2. Checks for commits ahead of base
3. Warns about uncommitted changes
4. Pushes the branch to origin
5. Gathers commit log and diff stats
6. Asks the LLM to generate a PR title + description
7. Creates the PR via `gh pr create`

## Requirements

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated
- Git repository with a remote named `origin`
