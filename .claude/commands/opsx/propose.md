---
name: 'OPSX: Propose'
description:
  Propose a new change - create it and generate all artifacts in one step
category: Workflow
tags: [workflow, artifacts]
---

Create a new OpenSpec change and generate all required artifacts (proposal,
design, tasks) in one step. When all apply-required artifacts are complete the
change is ready for `/opsx:apply`.

**Input**: The argument after `/opsx:propose` is the change name (kebab-case) OR
a plain-English description of what the user wants to build. If no input is
provided, ask what they want to build before proceeding.

Use `Skill(skill: 'openspec-propose')` — follow the skill's steps, artifact
guidelines, and guardrails for this invocation.
