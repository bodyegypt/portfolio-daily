## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used in this repository.

### Available skills
- skill-creator: Guide for creating effective skills. Use when users want to create a new skill or update an existing one. (file: /Users/abdullah/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into `$CODEX_HOME/skills` from curated or GitHub sources. Use when users ask to list/install skills. (file: /Users/abdullah/.codex/skills/.system/skill-installer/SKILL.md)
- portfolio-daily-analyst: Run and maintain the two-pass portfolio workflow in this repo (facts pass + AI post-analysis pass). Use for daily runs, data-fix workflows, and portfolio strategy analysis tasks. (file: /Users/abdullah/Desktop/workspace/self-growth/portfolio_daily/.codex/skills/portfolio-daily-analyst/SKILL.md)
- daily-analyst: Alias for `portfolio-daily-analyst`; use the same workflow and file. (file: /Users/abdullah/Desktop/workspace/self-growth/portfolio_daily/.codex/skills/portfolio-daily-analyst/SKILL.md)

### How to use skills
- Discovery: The list above is the skills available in this repository context (name + description + file path).
- Trigger rules: If the user names a skill (with `$SkillName` or plain text), use that skill for that turn.
- Missing/blocked: If a named skill path cannot be read, say so briefly and continue with the best fallback.
- Progressive disclosure: After a skill is selected, open only the target `SKILL.md` and any directly-needed referenced files.
- Coordination: If multiple skills apply, use the minimal set that covers the request and state the order.
