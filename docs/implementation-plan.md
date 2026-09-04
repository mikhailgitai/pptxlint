# План реализации pptxlint v0.1

Детальная нарезка на mergeable изменения находится в
[плане Pull Requests](pull-request-plan.md).

## 1. Стратегия поставки

V0.1 строится как CLI-first vertical slice:

```text
PPTX bytes
  → deterministic findings
  → config/suppressions/baseline
  → stylish/JSON/SARIF
  → exit 0/1/2
```

Не создаются web/API/repair/renderer компоненты. Главная метрика качества —
полезные high-confidence findings с низким false-positive rate.

Ориентировочная оценка: **12–18 инженерных дней** для одного разработчика плюс
время на сбор и ручную разметку реального validation corpus.

## 2. Release slices

| Срез          |    PR | Проверяемый результат                                  |
| ------------- | ----: | ------------------------------------------------------ |
| Foundation    | 01–03 | безопасно читается PPTX и строится shared context      |
| CLI alpha     |    04 | package rules работают через CLI и exit codes          |
| Rule complete | 05–07 | все десять v0.1 rules реализованы                      |
| CI beta       | 08–09 | suppressions, baseline, JSON и SARIF                   |
| v0.1          |    10 | security/performance/corpus calibration и release docs |

## 3. Этап 1 — workspace и adapter contracts

Соответствует PR 01–02.

### Результат

- pnpm workspace, Node 22, TypeScript strict, Vitest и CI;
- собираемые `@pptxlint/core` и `pptxlint` packages;
- ZIP reader/writer-independent interfaces;
- namespace-aware XML parser adapter;
- duplicate entry и malformed XML contract tests;
- synthetic minimal PPTX builder;
- ADR с выбранными libraries и ограничениями.

### Exit criteria

- root format/lint/typecheck/test/build проходят;
- packed CLI package можно установить в temporary consumer project;
- duplicate ZIP names не теряются из-за map overwrite;
- DTD/entities не разрешаются;
- fixture generation воспроизводима.

## 4. Этап 2 — OPC/Presentation context

Соответствует PR 03.

### Результат

- canonical part paths и security limits;
- lazy `ArchiveIndex` и cached `XmlPartStore`;
- content types и relationship graph;
- slide order, slide/layout/master/theme chain;
- shape inventory и z-order;
- partial context с typed diagnostics;
- source SHA-256 и normalized input key.

### Critical tests

- root и part relationship resolution;
- external targets никогда не fetch-ятся;
- nonsequential slide filenames дают правильные slide numbers;
- missing/malformed part не вызывает cascade exceptions;
- один entry/XML part читается и парсится не более одного раза.

## 5. Этап 3 — lint engine и CLI alpha

Соответствует PR 04.

### Результат

- versioned finding/report contracts;
- rule registry и prerequisites;
- deterministic fingerprints/sorting;
- JSON config schema и preset `recommended`;
- severity overrides и exit policy;
- package rules:
  - `package/broken-relationship`;
  - `package/missing-media`;
  - `package/malformed-xml`;
- минимальный stylish CLI output.

### Exit criteria

```bash
pnpm pptxlint fixtures/generated/missing-media.pptx
# exit 1, exact source/rId/target evidence
```

- Missing media создаёт один specialized finding.
- Malformed XML внутри PPTX возвращает finding, не internal failure.
- Повторный запуск даёт те же fingerprints и порядок.
- Code 0/1/2 соответствует спецификации.

## 6. Этап 4 — geometry rules

Соответствует PR 05–06.

### 6.1 Geometry engine

- EMU affine transforms;
- nested groups, child coordinate spaces, rotation и flips;
- transformed polygon/bbox;
- polygon intersection и slide clipping;
- normalized overlap/outside ratios;
- canonical shape-pair identity.

### 6.2 Rules

- `layout/outside-slide`;
- `layout/text-overlap`;
- `layout/text-occluded`.

Occlusion реализуется отдельно: нужны z-order, fill opacity и image alpha
evidence. Unknown transparency не выдаётся за доказанное перекрытие.

### Calibration fixtures

- intentional full-bleed background;
- text boxes с малым/большим пересечением;
- rotated text boxes;
- nested groups с scaling;
- text под solid opaque shape;
- text под transparent shape;
- JPEG и PNG с/без alpha;
- table cells и same-group constructs, которые нельзя считать обычной парой.

### Exit criteria

- Pair findings не дублируются в обратном порядке.
- Evidence содержит transformed bounds и ratio.
- Rule message говорит о text-frame geometry, не о pixel-perfect glyphs.
- High-confidence negative fixtures не дают findings.

## 7. Этап 5 — text, autofit и font policy

Соответствует PR 07.

### Результат

- effective run style resolver с provenance;
- paragraph/list/placeholder/layout/master/theme inheritance;
- title/body threshold classification;
- normalized stored autofit scale;
- explicit/theme font resolution для Latin/East Asian/Complex Script;
- rules:
  - `text/min-font-size`;
  - `text/autofit-scale-below-minimum`;
  - `text/autofit-enabled`;
  - `fonts/allowed`.

### Critical tests

- explicit и inherited sizes;
- theme font placeholders;
- mixed scripts;
- persisted scale ниже/выше minimum;
- runtime autofit без scale;
- unsupported/unresolved style chain;
- отсутствие duplicate minimum/autofit findings;
- отсутствие зависимости от installed system fonts.

### Exit criteria

- Линтер никогда не сообщает вычисленный effective size без resolved base size и
  valid persisted scale.
- Unresolved values остаются evidence/controlled behavior, а не guessed default.
- `fonts/allowed` выключен без configured allowlist.

## 8. Этап 6 — suppressions и baseline

Соответствует PR 08.

### Suppressions

- exact match по rule + location selectors;
- canonical shape pairs;
- optional reason;
- suppressed count и unused-suppression metadata;
- применение до baseline.

### Baseline

- versioned deterministic JSON;
- `--write-baseline`;
- new/existing/resolved classification;
- exit только по new gating findings;
- incompatible schema/tool major → code 2;
- без slide text и absolute paths.

### Exit criteria

Сценарий должен работать целиком:

```text
184 findings → write baseline
same deck → exit 0, 184 existing
add one overlap → exit 1, 1 new
remove seven old issues → 7 resolved
```

## 9. Этап 7 — CI outputs и package UX

Соответствует PR 09.

### Результат

- final stylish formatter;
- versioned JSON schema;
- SARIF 2.1.0 formatter;
- physical PPTX artifact + logical slide/shape locations;
- partial fingerprints;
- multi-file aggregation;
- `--output-file`;
- clean npm-pack/install/execute smoke;
- README quick start и CI examples.

### Exit criteria

- JSON и SARIF проходят schema/snapshot tests.
- Machine output идёт только в stdout/output file; diagnostics — stderr.
- SARIF docs не обещают line-level annotation или slide screenshot.
- Command может быть запущена через локально packed package как
  `npx pptxlint deck.pptx`.

## 10. Этап 8 — hardening и v0.1 release

Соответствует PR 10.

### Security

- ZIP bomb limits по declared и actual bytes;
- path traversal;
- duplicate entries;
- DTD/entities;
- malformed/truncated archives;
- external relationship no-fetch;
- redaction slide text/absolute paths из default machine output.

### Performance

- generated 50 MiB/100-slide benchmark;
- time и peak RSS записываются в release evidence;
- rule timings доступны в JSON debug metadata;
- archive/XML не копируются отдельно для каждого rule.

### Real-deck calibration

До фиксации defaults прогнать минимум 30 decks:

- не менее трёх generators/sources, например python-pptx, PptxGenJS и
  PowerPoint-authored/template-based output;
- не хранить proprietary decks в репозитории;
- вручную классифицировать layout/text findings как true/false positive;
- записать анонимные aggregate counts и известные blind spots;
- rule с недостаточной precision понизить до warning/off или сузить, а не
  компенсировать длинным README disclaimer.

Цель для default error layout rules — не менее 90% precision на размеченном
corpus. Это release gate продукта, но не статистическая гарантия для всех PPTX.

## 11. Fixture matrix

Для каждого rule обязательны:

- clean negative;
- positive на threshold boundary и явно выше threshold;
- malformed prerequisite;
- grouped/rotated variant, если применимо;
- deterministic fingerprint assertion;
- config severity/off override;
- suppression match и non-match;
- baseline new/existing transition.

Large fixtures генерируются в test setup. Бинарные customer files не
коммитятся.

## 12. CI gates

Целевые root commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:package
```

Rules не merge-ятся без positive/negative fixture. Public report/config schema
не меняется без schema tests и documentation update.

## 13. Основные риски

| Риск                                       | Снижение риска                                                    |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Intentional overlaps создают noise         | suppressions в v0.1, high-confidence defaults, corpus calibration |
| Baseline churn из-за regenerated shape IDs | exact stable fingerprint contract и честное documented limitation |
| Group transforms дают неверную геометрию   | отдельный matrix test corpus до layout rules                      |
| Autofit создаёт псевдоточность             | разделение stored scale и runtime uncertainty                     |
| Font inheritance неполон                   | provenance/unresolved вместо guessed values                       |
| SARIF не показывает слайд inline           | logical location сейчас; GitHub Check/rendering позже             |
| Конкуренты имеют похожие rules             | фокус на config, baseline, contracts, local CI DX                 |
| Scope снова расширяется                    | v0.1 non-goals и отдельный deferred roadmap                       |

## 14. Definition of Done

V0.1 готов, когда:

- все десять rules реализованы и описаны;
- CLI возвращает стабильные 0/1/2;
- config, suppressions и baseline работают end-to-end;
- stylish/JSON/SARIF outputs проверяются tests;
- real-deck corpus откалиброван и результаты задокументированы;
- core/CLI не требуют Office, LibreOffice, network или system-font scan;
- security/performance tests пройдены;
- packed-package smoke работает на clean consumer project;
- README содержит только реально выполненные команды;
- API/web/repair/rendering отсутствуют в v0.1 implementation.
