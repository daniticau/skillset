# Authoring a SKILL.md

## Contents
- Frontmatter rules
- Writing the description
- Body structure and length
- Progressive disclosure
- What `sks check` enforces
- Anti-patterns

## Frontmatter rules

```yaml
---
name: kebab-case-name        # lowercase, numbers, hyphens; max 64 chars
description: "..."           # non-empty, max 1024 chars
always: true                 # optional; load in every session
---
```

`name` cannot contain the reserved words "anthropic" or "claude". Avoid vague names — `helper`, `utils`, `tools`, `documents`. Prefer a specific noun phrase or gerund: `processing-pdfs`, `ios-app-submission`, `stop-slop`.

## Writing the description

This is the highest-leverage line in the file. At startup an agent loads only the name and description of every installed skill; the body loads only if the description convinces it to. A vague description means the skill never fires.

Rules:

1. **Third person.** It is injected into a system prompt. "Extracts text from PDFs" — not "I can help you with PDFs" or "You can use this to…".
2. **Say what it does AND when to use it.** Both halves. The "when" half is what matches against the user's request.
3. **Name concrete triggers.** Include the literal words and situations that should activate it — file types, phrases the user says, tools involved.
4. **Front-load the key use case.** The listing truncates long text.

```yaml
# Good — what + when + concrete triggers
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.

# Bad — no trigger conditions, agent cannot tell when it applies
description: Helps with documents
```

## Body structure and length

Assume the agent is already intelligent. Only add what it does not already have. Challenge every paragraph: does this justify its token cost?

```markdown
# Concise (~50 tokens)
## Extract PDF text
Use pdfplumber:
    with pdfplumber.open("f.pdf") as pdf:
        text = pdf.pages[0].extract_text()
```

The verbose version that first explains what a PDF is wastes context on something the model knows.

Match specificity to fragility:

- **High freedom** — many valid approaches, context decides. Give direction, not steps.
- **Medium freedom** — a preferred pattern exists. Give a template to adapt.
- **Low freedom** — fragile, order matters, mistakes are costly. Give the exact command and say not to deviate.

Keep the body under 500 lines. Split before that.

## Progressive disclosure

SKILL.md is a table of contents. Bundle detail in sibling files that load only when needed:

```text
my-skill/
├── SKILL.md              # loaded when triggered
├── references/
│   ├── authoring.md      # loaded only if referenced
│   └── examples.md
└── scripts/
    └── validate.py       # executed, never loaded into context
```

**Keep references one level deep from SKILL.md.** An agent following a reference inside a reference tends to preview with partial reads and miss content.

For any reference file over 100 lines, put a table of contents at the top so a partial read still reveals the full scope.

## What `sks check` enforces

- Folder name matches frontmatter `name`
- Body is non-empty
- Description clearly states a trigger condition
- Description under 300 characters
- Body under 1000 words / 500 lines
- Every referenced `references/…` or `scripts/…` path actually exists
- No `.git`, `node_modules`, `__pycache__`, `.DS_Store` inside the skill

Run `sks check <name>` after authoring, and fix every error before reporting.

## Anti-patterns

- **Time-sensitive content.** "Before August, use the old API" goes stale. Put superseded material under an "Old patterns" heading instead.
- **Inconsistent terminology.** Pick one word per concept and keep it. Mixing "field", "box", "element" makes instructions harder to follow.
- **Too many options.** "You could use pypdf, or pdfplumber, or PyMuPDF…" Give one default plus an escape hatch for the known exception.
- **Windows-style paths.** Always forward slashes.
- **Abstract examples.** Concrete input/output pairs teach style far better than description does.
