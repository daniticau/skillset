# Authoring a SKILL.md

## Contents
- Frontmatter rules
- Writing the description
- Category and kind
- Body structure and length
- Progressive disclosure
- What `sks check` enforces
- Anti-patterns

## Frontmatter rules

```yaml
---
name: kebab-case-name        # lowercase, numbers, single hyphens; 64 chars at most
description: "..."           # non-empty; under 300 chars
category: "Design"           # the sidebar group; Title Case, 40 chars at most
kind: workflow               # tool, workflow, judgement, or rule
always: true                 # optional; copies the body into every agent's global instructions
---
```

Keep `name` to 64 characters, and keep "anthropic" and "claude" out of it. Some agents reject either, and `sks` does not check for them. Avoid vague names, such as `helper`, `utils`, `tools`, or `documents`. Prefer a specific noun phrase or gerund: `processing-pdfs`, `ios-app-submission`, `stop-slop`.

Set `always: true` only for a short rule with no clear trigger moment. Its body loads in every session of every agent, so keep it under 150 words.

## Writing the description

This is the highest-leverage line in the file. At startup an agent loads only the name and description of every installed skill. The body loads only if the description convinces it to. A vague description means the skill never fires.

Rules:

1. **Third person.** It is injected into a system prompt. Write "Extracts text from PDFs", not "I can help you with PDFs" or "You can use this to…".
2. **Say what it does AND when to use it.** Both halves. The "when" half is what matches against the user's request.
3. **Name concrete triggers.** Include the literal words and situations that should activate it: file types, phrases the user says, tools involved, and the slash name.
4. **Front-load the key use case.** The listing truncates long text.
5. **Fence off near neighbors.** When a similar skill or a common misreading exists, add one "Not for…" sentence.
6. **Hold back costly skills.** For a skill that is slow, wide, or has side effects, write "Use only when the user…" so it does not fire on its own. Keep the words "when the user", because `sks check` looks for them.

```yaml
# Good: what + when + concrete triggers
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.

# Good: a named task prompt, held back because it scans the whole app
description: Finds implicit state machines in the current app, where state hides in flags, status strings, and scattered transitions. Use only when the user runs /state-machines or asks to find implicit or hidden state machines.

# Bad: no trigger conditions, so an agent cannot tell when it applies
description: Helps with documents
```

## Category and kind

Every skill gets both. You read the whole skill, so you judge better than any keyword match.

**Category** is the group the skill sits in, in the desktop sidebar. It answers "what part of my work is this for?" Run `sks list` and reuse an existing category when one fits, such as `Design`, `Writing`, `Learning`, or `Research`. Make a new one only when none fits. Keep it one or two words in Title Case. Leave `Special` to skillify.

**Kind** is the kind of knowledge the skill carries:

1. **tool.** How to drive a specific piece of software or CLI.
2. **workflow.** Ordered steps for a task.
3. **judgement.** An algorithm for deciding or evaluating.
4. **rule.** A durable constraint to respect.

`sks catalog` groups by kind. A skill with no `kind` falls back to a keyword guess from its description, so always set it.

To change either one later, run `sks category <name> <category>` or `sks kind <name> <kind>`.

## Body structure and length

Assume the agent is already intelligent. Add only what it does not already have. Challenge every paragraph: does this justify its token cost?

```markdown
# Concise (~50 tokens)
## Extract PDF text
Use pdfplumber:
    with pdfplumber.open("f.pdf") as pdf:
        text = pdf.pages[0].extract_text()
```

The verbose version, which first explains what a PDF is, wastes context on something the model knows.

Match specificity to fragility:

- **High freedom.** Many valid approaches; context decides. Give direction, not steps.
- **Medium freedom.** A preferred pattern exists. Give a template to adapt.
- **Low freedom.** Fragile, order matters, mistakes are costly. Give the exact command and say not to deviate.

Say why when a rule is not obvious. An agent that knows the reason handles the edge case the rule did not name.

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

Errors:

- Folder name matches frontmatter `name`.
- Body and description are non-empty.
- Every referenced `references/…`, `scripts/…`, or `assets/…` path exists.

Warnings:

- The description has no trigger phrase, such as "Use when", "when the user", "user asks", or "before".
- The description is over 300 characters.
- The body is over 1000 words or 500 lines.
- An always-on body is over 150 words.
- The skill folder holds `.git`, `node_modules`, `__pycache__`, or `.DS_Store`.

Run `sks check <name>` after authoring, and fix every error before reporting.

## Anti-patterns

- **Time-sensitive content.** "Before August, use the old API" goes stale. Put superseded material under an "Old patterns" heading instead.
- **Inconsistent terminology.** Pick one word per concept and keep it. Mixing "field", "box", and "element" makes instructions harder to follow.
- **Too many options.** "You could use pypdf, or pdfplumber, or PyMuPDF…" Give one default plus an escape hatch for the known exception.
- **Windows-style paths.** Always use forward slashes.
- **Abstract examples.** Concrete input/output pairs teach style far better than description does.
- **Secrets.** Never include a token, key, password, or credentialed URL. Every connected agent gets a copy.
