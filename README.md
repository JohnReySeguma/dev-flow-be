# DevFlow API

REST + realtime API for [DevFlow](https://github.com/JohnReySeguma/dev-flow), a sprint-based issue tracker:
projects with custom workflows, backlogs, sprints, reports, GitHub integration and Live Sync.

> **Status:** project setup. Implementation follows the brief in [`docs/BRIEF.md`](docs/BRIEF.md).

## Stack

Node.js · TypeScript · Express 5 · Socket.IO · PostgreSQL · Redis (optional) · Nodemailer · Octokit · Docker

## Getting started

```bash
cp .env.example .env        # fill in values; never commit .env or *.pem files
npm install
```

Setup, scripts and the Docker workflow are documented as each milestone lands; see the milestones in
[`docs/BRIEF.md` §7](docs/BRIEF.md#7-git-workflow--follow-the-frontends-conventions-exactly).

## Contributing

- [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/)
- One `feat/*` branch per milestone, merged into `main` with `--no-ff`
- Each release: `chore(release): vX.Y.Z` commit, updated `CHANGELOG.md` and an annotated tag
