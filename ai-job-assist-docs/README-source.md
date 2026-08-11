# AI Job Assist

A multi-agent job-search assistant that helps candidates collect public job postings, evaluate job fit, create evidence-grounded application materials, and organize application drafts.

[Documentation](https://wp225.github.io/ai-job-assist/) · [Repository](https://github.com/wp225/ai-job-assist)

## How it works

```text
/setup → /scrape → /rank → /apply <job_id>
```

* `/setup` creates or updates a private candidate profile.
* `/scrape` collects public job postings from configured Greenhouse and Lever boards.
* `/rank` performs compact job-fit triage against the candidate profile.
* `/apply` runs a detailed fit evaluation and, after approval, creates tailored application materials.

The application workflow uses a drafter–reviewer pattern: one agent drafts the resume and cover letter, while an independent reviewer subagent checks factual grounding, requirement coverage, unsupported claims, and keyword relevance before final document verification.

## Features

* Conversation-first candidate onboarding with incremental profile updates
* Public Greenhouse and Lever job-board collection
* Normalized, deduplicated job records using Pydantic schemas
* Job ranking with skill, experience, role-level, location, language, and work-authorization checks
* Approval-gated resume and cover-letter generation
* Multi-agent drafter–reviewer workflow
* ATS-oriented LaTeX templates, PDF compilation, visual checks, and text-layer verification
* Local application tracker and per-job evaluation records
* GitHub Actions CI/CD and Azure container deployment

## Quick start

### 1. Install dependencies

```bash
uv sync
```

### 2. Create your candidate profile

Open the repository in Claude Code and run:

```text
/setup
```

For first-time setup, add a CV to `documents/original_resume/` or paste its text into the conversation. The completed profile is stored locally at:

```text
data/candidate-profile/candidate-profile.md
```

### 3. Configure job sources

Create `data/job-sources.json`:

```json
[
  {
    "provider": "greenhouse",
    "board_token": "company-board-token"
  },
  {
    "provider": "lever",
    "site": "company-site"
  }
]
```

### 4. Run the workflow

```text
/scrape
/rank
/apply <job_id>
```

The Python scraper can also be run directly:

```bash
uv run ai_job_assist scrape greenhouse --board-token "<board_token>"
uv run ai_job_assist scrape lever --site "<site>"
```

## Development commands

```bash
task tests      # Run tests
task coverage   # Run tests with coverage
task type       # Type-check with ty
task lint       # Lint with Ruff
task format     # Format with Ruff
task docs       # Build documentation
task serve      # Serve documentation locally
```

## Privacy

Your original CV, completed candidate profile, job evaluations, tailored documents, and application tracker are personal data and should remain local. They are excluded through `.gitignore`.

The repository includes only reusable templates, folder structure, and workflow definitions.

## Documentation

The full design, workflow, data model, and command reference are available at [wp225.github.io/ai-job-assist](https://wp225.github.io/ai-job-assist/).

## License

MIT
