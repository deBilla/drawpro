Generate a changelog for DrawPro based on git history.

If an argument is provided (e.g., a date like "2026-03-01" or a commit range like "abc123..HEAD"), scope the changelog to that range. Otherwise, generate from all commits.

Steps:
1. Run `git log --oneline --no-merges` (scoped to range if provided)
2. Group commits by category:
   - **Features** — new functionality
   - **Fixes** — bug fixes
   - **Security** — security improvements
   - **Infrastructure** — CI/CD, Docker, deployment changes
   - **Refactoring** — code improvements without behavior change
3. For each entry, write a user-friendly description (not the raw commit message)
4. Note any breaking changes or migration requirements

Format output as a markdown changelog:

```
## [Date Range]

### Features
- Description of feature

### Fixes
- Description of fix

### Security
- Description of security improvement
```

This is useful for release notes, stakeholder updates, or team standups.
