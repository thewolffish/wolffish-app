# RELEASE.md — Wolffish Release Procedure

Instructions for an agent cutting a release of `wolffish-app`. Follow the steps **in order**. If anything looks wrong, **stop and report** (see [If issues are found](#if-issues-are-found--stop)) — do not push a release past an unresolved problem.

---

## Non-negotiables (read before doing anything)

- **Never hand-edit the version** in `package.json` or `package-lock.json`. `npm run release` bumps them for you (it runs `npm version patch`). The only version you touch by hand is the **README badge**.
- **You edit exactly two things by hand for a release:** the **changelog** (`src/changelog/<YYYY-MM>/en.md` **and** `ar.md`) and the **README version badge**. Nothing else about the version.
- **Both changelog languages, always.** Every entry is written in `en.md` **and** `ar.md`. AR is a full translation, not a stub. Never ship one without the other.
- **Stay on `main`.** No branches. The release is committed and pushed on `main`.
- **`npm run release` is the last step and it is outward-facing** — it pushes a commit and a tag to `origin`, which triggers the published build. Only run it once steps 1–4 are done and clean. Never run it to "see what happens."
- **When in doubt, stop.** A halted release costs nothing. A bad release is public.

---

## What `npm run release` actually does

```
npm run release  ==  npm version patch  &&  git push origin main --tags
```

1. `npm version patch` bumps `1.0.N` → `1.0.N+1` in `package.json` + `package-lock.json`, creates a **separate** commit named `1.0.N+1`, and tags it `v1.0.N+1`.
2. `git push origin main --tags` pushes `main` and the new tag to `origin`.

**Consequence you must plan for:** `npm version patch` **refuses to run on a dirty working tree**. So all of your changelog + README + feature changes must be **committed first**, in their own regular commit. The version-bump commit that `npm run release` makes touches *only* `package.json` and `package-lock.json`. (This is the observed shape of every prior release — a meaningful commit, then a clean `1.0.N` commit.)

---

## Procedure

### 1. Analyze all changes

- Run `git status` and `git diff` (and `git diff --staged`) to see everything pending since the last release.
- Also review commits made since the last version tag if the work was already committed: `git log $(git describe --tags --abbrev=0)..HEAD --stat`.
- Build a short mental (or written) list of **what actually changed from the user's point of view** — features, fixes, behavior changes. You need this for the changelog anyway.
- If there is **nothing user-facing to release**, say so and stop — don't cut an empty release.

### 2. Quick third-party sanity check (not a deep audit)

Goal: catch anything **obviously bad or likely to break things**. Quick and good-enough — not an exhaustive review.

- Run the mechanical guards: `npm run typecheck` and `npm run lint`.
- Do **one** independent review pass over the diff — a fresh set of eyes on the changes (e.g. a reviewer subagent, or `/code-review` at low effort). Look only for: obvious breakage, something half-finished, a change that clearly regresses existing behavior, secrets/keys committed by accident.
- This is a **third-party smell test, not a full code review.** Don't rabbit-hole.

**If this surfaces a real problem → STOP.** Go to [If issues are found](#if-issues-are-found--stop). Do not proceed to changelog/version/release.

### 3. Write the changelog entries (EN + AR)

Only reach this step if step 2 came back clean.

1. **Compute the next version.** It is a **patch bump of the current `package.json` version**. If `package.json` says `1.0.214`, the release version is **`1.0.215`**. (This is the version `npm run release` will create — you are writing the changelog and README *ahead* of that bump.)
2. **Pick the changelog folder** by today's date: `src/changelog/<YYYY-MM>/`. If the month rolled over and the folder doesn't exist yet, create it with `en.md` and `ar.md`.
3. **Read the last 2–3 existing entries in both files first** and match their house style exactly:
   - Version header — EN: `## v1.0.215 — <YYYY-MM-DD> \`Latest\`` · AR: `## الإصدار 1.0.215 — <YYYY-MM-DD> \`الأحدث\``
   - **Move the `` `Latest` `` / `` `الأحدث` `` marker off the previous top entry** — only the newest entry carries it.
   - One `### Headline` per notable change, followed by a paragraph of **flowing, benefit-first prose** (not a bullet list of commits), with the key phrases in **bold**. Written for a user, not a developer.
   - New entry goes at the **top** of each file.
   - AR is a genuine translation of the EN entry — same headlines, same content, natural Arabic.
4. Use today's real date. Keep EN and AR in lockstep.

### 4. Bump the version in the README

- Edit **`README.md`**, the version badge line only:
  ```
  [![Version](https://img.shields.io/badge/version-1.0.214-green.svg)](https://wolffi.sh)
  ```
  → change `1.0.214` to the **same next version** you used in the changelog (`1.0.215`).
- **Do not touch `package.json` / `package-lock.json`.** `npm run release` owns those.

### 5. Commit, then release

Only if **all** of these are true: step 2 was clean, changelog entries exist in **both** `en.md` and `ar.md`, and the README badge is bumped to the next version.

1. **Commit all pending work in one regular commit** — feature/fix source changes **+** the changelog EN/AR **+** the README badge. Use a concise, descriptive message summarizing the release's headline change (e.g. `add: autocomplete suggestions`). This is required so the tree is clean for the next command.
2. Confirm the tree is clean: `git status` shows nothing to commit.
3. Run:
   ```
   npm run release
   ```
   This bumps the version, makes the `1.0.215` commit, tags it, and pushes `main` + tags to `origin`.
4. Report the released version and confirm the push succeeded.

---

## If issues are found — STOP

Applies to any blocker: a failing typecheck/lint, a bad or breaking change spotted in step 2, missing changelog, an unclear diff — anything that means this should not ship as-is.

1. **Stop immediately.** Do not write the changelog, do not bump the version, do not run `npm run release`.
2. **Report the issues minimally** — just *what* they are, briefly. One line each. No fixes applied, no long analysis.
3. **Hand the decision to the user.** Wait for them to decide how to address each issue.
4. Once the user has addressed / approved, **start over from step 1** and run the whole procedure again from the top.

Do not partially release, do not work around a flagged issue, and do not decide on the user's behalf.

---

## Quick reference

| Thing | Where | Edit by hand? |
|---|---|---|
| Version source of truth | `package.json` → `"version"` | **No** — `npm run release` bumps it |
| Version badge | `README.md` badge line | **Yes** — to next patch version |
| Changelog (English) | `src/changelog/<YYYY-MM>/en.md` | **Yes** |
| Changelog (Arabic) | `src/changelog/<YYYY-MM>/ar.md` | **Yes** — full translation |

```bash
git status && git diff                 # 1. see all changes
npm run typecheck && npm run lint      # 2. mechanical guards (+ one independent review pass)
# 3. write src/changelog/<YYYY-MM>/{en,ar}.md   (next = patch bump of package.json version)
# 4. bump README badge to the same next version
git add -A && git commit -m "<summary>"  # 5. commit everything first (tree must be clean)
npm run release                          #    then bump + tag + push
```

**One-line summary:** analyze → quick third-party check → if clean, write EN+AR changelog + bump README badge → commit everything → `npm run release`. If anything is wrong, stop, report it minimally, let the user decide, then start over.
