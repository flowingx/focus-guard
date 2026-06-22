<#
Install verified Codex-compatible skills globally.

This script intentionally targets Codex only:
  npx skills add <repo> -g -a codex --copy -y --skill <name>

Verified on 2026-06-22 with:
  npx -y skills add <repo> -l --full-depth
  GitHub repo star counts via GitHub API

Notes:
  - OpenAI `frontend-skill` from the provided URL is not currently exposed by
    `openai/skills` to the `skills` CLI, so it is reported and skipped.
  - Vercel `vercel-deploy-claimable` is currently exposed as `deploy-to-vercel`.
  - SuperClaude Framework is Claude-oriented; no broadly useful Codex skill from
    it is installed here.
#>

[CmdletBinding()]
param(
  [switch]$PlanOnly
)

$ErrorActionPreference = "Stop"

$RepoStars = @(
  @{ Repo = "openai/skills"; Stars = 22679; Url = "https://github.com/openai/skills" },
  @{ Repo = "anthropics/skills"; Stars = 153685; Url = "https://github.com/anthropics/skills" },
  @{ Repo = "vercel-labs/agent-skills"; Stars = 28187; Url = "https://github.com/vercel-labs/agent-skills" },
  @{ Repo = "obra/Superpowers"; Stars = 235397; Url = "https://github.com/obra/superpowers" },
  @{ Repo = "SuperClaude-Org/SuperClaude_Framework"; Stars = 23342; Url = "https://github.com/SuperClaude-Org/SuperClaude_Framework" }
)

$InstallGroups = @(
  @{
    Label = "OpenAI verified Codex skills"
    Repo = "https://github.com/openai/skills"
    Skills = @(
      "figma-implement-design",
      "playwright"
    )
  },
  @{
    Label = "Anthropic design/testing skills"
    Repo = "https://github.com/anthropics/skills"
    Skills = @(
      "frontend-design",
      "webapp-testing",
      "canvas-design",
      "brand-guidelines"
    )
  },
  @{
    Label = "Vercel UI/React/deploy skills"
    Repo = "https://github.com/vercel-labs/agent-skills"
    Skills = @(
      "web-design-guidelines",
      "vercel-react-best-practices",
      "deploy-to-vercel"
    )
  },
  @{
    Label = "Superpowers Codex skills"
    Repo = "https://github.com/obra/Superpowers"
    Skills = @(
      "brainstorming",
      "dispatching-parallel-agents",
      "executing-plans",
      "finishing-a-development-branch",
      "receiving-code-review",
      "requesting-code-review",
      "subagent-driven-development",
      "systematic-debugging",
      "test-driven-development",
      "using-git-worktrees",
      "using-superpowers",
      "verification-before-completion",
      "writing-plans",
      "writing-skills"
    )
  }
)

$Skipped = @(
  @{
    Name = "frontend-skill"
    Reason = 'Provided OpenAI URL currently is not exposed by `npx skills add https://github.com/openai/skills -l --full-depth`.'
    ProvidedUrl = "https://github.com/openai/skills/tree/main/skills/.curated/frontend-skill"
  },
  @{
    Name = "react-best-practices"
    Reason = 'Vercel exposes this as `vercel-react-best-practices`; installing that verified skill instead.'
    ProvidedUrl = "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices"
  },
  @{
    Name = "vercel-deploy-claimable"
    Reason = 'Vercel exposes this deployment skill as `deploy-to-vercel`; installing that verified skill instead.'
    ProvidedUrl = "https://github.com/vercel-labs/agent-skills/tree/main/skills/vercel-deploy-claimable"
  },
  @{
    Name = "SuperClaudeFramework"
    Reason = "Framework is Claude-oriented; not installed into Codex by default. Repo is high-star but not selected as a Codex skill source."
    ProvidedUrl = "https://github.com/SuperClaude-Org/SuperClaude_Framework"
  }
)

function Invoke-SkillsAdd {
  param(
    [string]$Repo,
    [string[]]$Skills
  )

  $args = @(
    "-y",
    "skills",
    "add",
    $Repo,
    "-g",
    "-a",
    "codex",
    "--copy",
    "-y",
    "--skill"
  ) + $Skills

  if ($PlanOnly) {
    Write-Host ("npx " + ($args -join " "))
    return
  }

  & npx @args
  if ($LASTEXITCODE -ne 0) {
    throw "npx $($args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Verified repositories:" -ForegroundColor Cyan
foreach ($repo in $RepoStars) {
  Write-Host ("  {0}  stars={1}  {2}" -f $repo.Repo, $repo.Stars, $repo.Url)
}
Write-Host ""

Write-Host "Skipped or renamed after verification:" -ForegroundColor Yellow
foreach ($item in $Skipped) {
  Write-Host ("  {0}: {1}" -f $item.Name, $item.Reason)
}
Write-Host ""

foreach ($group in $InstallGroups) {
  Write-Host ("==> " + $group.Label) -ForegroundColor Cyan
  Invoke-SkillsAdd -Repo $group.Repo -Skills $group.Skills
}

Write-Host ""
Write-Host "Done. Restart Codex to pick up newly installed skills." -ForegroundColor Green
