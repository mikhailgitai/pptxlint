# Deferred platform and API concept

> **Статус: вне scope v0.1. Не реализовывать по этому документу.**

Первый продукт — локальный open-source CLI `pptxlint`. API и web dashboard имеют
смысл только после подтверждения качества rules на реальных decks и появления
регулярного CI usage.

## Возможная платная платформа после v0.1

- hosted CI/PR reports;
- organization-wide policies;
- managed baselines и historical regression;
- artifact rendering и slide thumbnails;
- visual diffs;
- GitHub Check/App с deep links;
- retention, audit и team access controls.

Предполагаемый pipeline:

```text
Codex / Claude / generator
  → generate PPTX
  → pptxlint
  → optional render
  → visual regression
  → CI artifact / PR report
```

Никакие HTTP routes, database schemas, auth flows или billing contracts не
фиксируются до получения usage evidence. `@pptxlint/core` остаётся единым
источником findings для CLI и возможной будущей платформы.
