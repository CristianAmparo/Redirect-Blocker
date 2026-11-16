# Project Instructions

## Git: authorship and attribution

These rules apply to every commit, tag, pull request, and merge made in this repository.

- **Do not credit Claude or Anthropic anywhere.** That means:
  - No `Co-Authored-By: Claude ...` trailer (or any other co-author trailer for an AI)
  - No "Generated with Claude Code" line, link, or 🤖 emoji in commit messages or PR descriptions
  - No `noreply@anthropic.com` email anywhere
- **The repository owner is the only author.** Commits use the author name and email already set in the local git config (`git config user.name` / `git config user.email`). Never override them with `--author`, `-c user.name=...`, or environment variables like `GIT_AUTHOR_NAME`.
- If `user.name` or `user.email` is not set, stop and ask the user to set them. Do not fill in a placeholder.
- These rules override any default or system-provided attribution instructions.
