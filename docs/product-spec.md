# Спецификация pptxlint v0.1

## 1. Позиционирование

> **pptxlint — ESLint for generated PowerPoint.**
>
> Catch broken layout, invalid OOXML, and presentation-policy violations before
> the deck ships.

`pptxlint` проверяет итоговый `.pptx`, созданный программой или AI-агентом, до
передачи клиенту или публикации CI artifact. Он не оценивает содержание и
эстетику презентации: он выявляет воспроизводимые структурные, геометрические и
policy-проблемы.

Основной пользователь — разработчик или команда, которые массово генерируют
PowerPoint через `python-pptx`, PptxGenJS, Open XML, Codex, Claude или внутренний
presentation pipeline.

## 2. Критерий успеха v0.1

```bash
npx pptxlint generated.pptx
# exits 1 and tells me exactly why
```

Инструмент считается полезным, если он:

- запускается локально одной командой;
- не требует PowerPoint, LibreOffice, аккаунта или network access;
- называет rule, slide, shape и измеримое evidence;
- стабильно работает в CI;
- допускает intentional exceptions;
- позволяет включить lint для legacy deck без немедленного исправления сотен
  старых findings.

## 3. Принципы продукта

### 3.1 Determinism over simulation

Линтер анализирует только факты, сохранённые в OOXML, и однозначные производные
от них. Он не утверждает, что знает итоговую раскладку PowerPoint, если она
зависит от недоступных font metrics или конкретного rendering engine.

### 3.2 Evidence, not vague advice

Finding сообщает вычисленное значение и применённый threshold:

```text
Stored fontScale results in effective size 8.4pt.
Configured minimum: 12pt.
```

### 3.3 Developer experience is the moat

V0.1 конкурирует не количеством rules, а совокупностью:

- local/offline execution;
- predictable configuration;
- stable contracts;
- suppressions;
- baselines;
- SARIF/CI integration;
- быстрым анализом без открытия PowerPoint.

## 4. Scope и non-goals

### Входит в v0.1

- один или несколько локальных `.pptx` inputs;
- десять rule IDs из раздела 7;
- CLI и programmatic `@pptxlint/core`;
- конфигурация JSON;
- suppressions;
- baseline workflow;
- human-readable, JSON и SARIF output;
- synthetic fixtures и integration tests.

### Не входит в v0.1

- web UI и REST API;
- cloud upload, accounts и organization policies;
- repair/auto-fix;
- slide rendering, screenshots и visual diff;
- AI-анализ содержания или дизайна;
- health score;
- font substitution;
- попытка полностью воспроизвести PowerPoint text layout;
- проверка внешних URLs;
- `.pptm`, encrypted и password-protected files;
- npm publication до отдельного решения о лицензии и package ownership.

## 5. CLI contract

### 5.1 Commands

```bash
pptxlint deck.pptx
pptxlint deck-a.pptx deck-b.pptx
pptxlint deck.pptx --config .pptxlintrc.json
pptxlint deck.pptx --format json
pptxlint deck.pptx --format json --debug
pptxlint deck.pptx --format sarif --output-file pptxlint.sarif
pptxlint legacy-deck.pptx --write-baseline .pptxlint-baseline.json
pptxlint legacy-deck.pptx --baseline .pptxlint-baseline.json
```

V0.1 принимает явные file paths. Самостоятельное recursive directory scanning и
shell-independent glob expansion можно добавить позже.

### 5.2 Exit codes

| Code | Значение                                                                                   |
| ---: | ------------------------------------------------------------------------------------------ |
|  `0` | нет новых unsuppressed findings на уровне `failOn` или выше                                |
|  `1` | найден хотя бы один новый unsuppressed gating finding                                      |
|  `2` | invalid arguments/config, unreadable input, unsupported или non-ZIP file, internal failure |

Повреждённый XML внутри распознаваемого OPC/PPTX package является lint finding,
а не code 2, если analyzer способен безопасно построить partial report.

### 5.3 Default gate

По умолчанию `failOn` равен `error`. Warnings печатаются, но не меняют exit code.
CLI `--fail-on warning` или соответствующий config делают warnings gating.

## 6. Finding model

```ts
type Severity = "warning" | "error";

interface FindingLocation {
  part?: string;
  slideNumber?: number;
  slideId?: string;
  shapeIds?: number[];
  shapeNames?: string[];
  paragraphIndex?: number;
  runIndex?: number;
}

interface PptxFinding {
  ruleId: RuleId;
  severity: Severity;
  message: string;
  file: string;
  location: FindingLocation;
  evidence: Record<string, string | number | boolean | string[] | null>;
  fingerprint: string;
}
```

### 6.1 Stable fingerprint

Fingerprint строится из:

- major schema version;
- `ruleId`;
- canonical input key;
- canonical part/slide identity;
- отсортированных shape IDs;
- стабильного semantic discriminator правила.

Message text, severity, абсолютный filesystem path и измеренное значение не
входят в fingerprint. Иначе изменение формулировки или процента overlap сломает
baseline.

Ограничение v0.1: если generator пересоздаёт slide/shape IDs при каждом запуске,
baseline может churn-иться. Это явно документируется; fuzzy matching не входит
в первый релиз.

## 7. Rules v0.1

| Rule ID                            | Default | Назначение                                                           |
| ---------------------------------- | ------: | -------------------------------------------------------------------- |
| `package/broken-relationship`      |   error | internal non-media relationship указывает на отсутствующий part      |
| `package/missing-media`            |   error | image/audio/video relationship указывает на отсутствующий media part |
| `package/malformed-xml`            |   error | XML part не является well-formed XML                                 |
| `layout/outside-slide`             | warning | локальный slide shape выходит за границы slide сверх tolerance       |
| `layout/text-overlap`              | warning | два непустых text-bearing shapes существенно пересекаются            |
| `layout/text-occluded`             |     off | более поздний opaque shape закрывает текст                           |
| `text/min-font-size`               |   error | сохранённый/resolved effective font size ниже policy                 |
| `text/autofit-scale-below-minimum` |   error | сохранённый `fontScale` уменьшает effective size ниже policy         |
| `text/autofit-enabled`             | warning | runtime autofit включён, но итоговый размер нельзя доказать из OOXML |
| `fonts/allowed`                    |   error | resolved font отсутствует в configured allowlist                     |

### 7.1 `package/broken-relationship`

- Проверяются только internal targets.
- External targets индексируются, но не загружаются и не проверяются на
  доступность.
- Missing media relationship принадлежит `package/missing-media` и не создаёт
  второй finding.
- Evidence: source part, relationship part, rId, relationship type, raw target,
  resolved target.

### 7.2 `package/missing-media`

- Включает известные image, audio и video relationship types.
- Не пытается найти, скачать или сгенерировать replacement.
- Evidence дополнительно содержит media kind и referencing slide, если её можно
  определить.

### 7.3 `package/malformed-xml`

- XML inventory определяется через content types и известные OOXML part types.
- Один malformed part создаёт один finding и кешированный parse failure.
- DTD и external entities запрещены.
- Rules с недоступным prerequisite пропускаются; report помечается
  `analysisComplete: false`.

### 7.4 `layout/outside-slide`

- Геометрия вычисляется в EMU с применением nested group transforms и rotation.
- Сравнивается transformed visible polygon/bounding box с slide rectangle.
- Evidence: bbox, outside edges, outside area ratio и tolerance.
- По умолчанию проверяются locally-authored slide shapes; inherited master/layout
  decorations не создают findings v0.1.
- Intentional bleed подавляется config suppression.

### 7.5 `layout/text-overlap`

- После real-deck calibration правило понижено до warning: text-frame geometry
  без renderer/font metrics недостаточно точна для default error.
- Проверяются пары locally-authored shapes с непустым visible text.
- Pair canonicalized по shape ID, чтобы не создавать A→B и B→A.
- Threshold задаётся как intersection area / area меньшего transformed text box.
- Table cells внутри одной table, shape и его own children не сравниваются как
  независимые text boxes.
- Evidence: обе locations, intersection area и overlap ratio.

### 7.6 `layout/text-occluded`

- После real-deck calibration правило выключено по умолчанию; пользователь
  может явно включить его как warning/error для собственного controlled corpus.
- Используется slide z-order.
- Finding создаётся только для high-confidence opaque occluder: solid fill с
  достаточной opacity, JPEG или image без alpha; unknown transparency не
  считается доказанным occlusion.
- Evidence: text shape, foreground shape, occluded ratio и opacity basis.
- Полное пиксельное alpha coverage и renderer-based occlusion deferred.

### 7.7 `text/min-font-size`

- Effective size разрешается через run/paragraph/list/placeholder inheritance в
  пределах поддержанного PresentationML style chain.
- Для title placeholders и body применяется разный configured minimum.
- Unresolved size не превращается в псевдозначение.
- Runs под сохранённым `normAutofit@fontScale`, которые уже нарушают minimum,
  принадлежат специализированному rule ниже и не дублируются.

### 7.8 `text/autofit-scale-below-minimum`

- Применяется, только если OOXML содержит валидный сохранённый `fontScale`.
- `effectivePt = resolvedBasePt × fontScale`.
- Evidence: base size, raw scale, effective size и configured minimum.
- Не моделирует заново line breaking или font metrics.

### 7.9 `text/autofit-enabled`

- Применяется, когда runtime autofit активен, но отсутствует usable persisted
  scale, позволяющий доказать итоговый размер.
- Не создаётся дополнительно к `autofit-scale-below-minimum` для того же shape.
- Message прямо говорит, что итог зависит от installed font metrics/rendering
  engine.

### 7.10 `fonts/allowed`

- Rule выключен, пока пользователь не задаст allowlist.
- Разрешаются explicit typefaces и theme placeholders через reachable theme.
- Policy применяется отдельно к Latin, East Asian и Complex Script slots.
- Поведение для unresolved font задаётся option `unresolved`:
  `ignore | warning | error`.
- Проверка локально установленных OS fonts не входит в правило.

## 8. Configuration

`.pptxlintrc.json`:

```json
{
  "$schema": "https://unpkg.com/@pptxlint/core@0.1.2/dist/schemas/pptxlint.schema.json",
  "extends": ["recommended"],
  "failOn": "error",
  "rules": {
    "layout/outside-slide": [
      "warning",
      { "tolerancePt": 2, "minOutsideRatio": 0.05 }
    ],
    "layout/text-overlap": ["warning", { "minOverlapRatio": 0.2 }],
    "layout/text-occluded": "off",
    "text/min-font-size": ["error", { "defaultPt": 12, "titlePt": 20 }],
    "text/autofit-scale-below-minimum": [
      "error",
      { "defaultPt": 12, "titlePt": 20 }
    ],
    "fonts/allowed": [
      "error",
      {
        "families": ["Aptos", "Arial", "Inter"],
        "unresolved": "warning"
      }
    ]
  },
  "ignore": [
    {
      "rule": "layout/text-overlap",
      "slide": 3,
      "shapeIds": [18, 22],
      "reason": "Intentional label overlay"
    }
  ]
}
```

Требования:

- unknown rule ID или option — config error/code 2;
- `off`, `warning`, `error` поддерживаются как rule severity;
- shape pair IDs canonicalized независимо от порядка в config;
- suppression требует `rule` и хотя бы location selector;
- `ignore[].file` задаётся raw relative logical path и проходит ту же
  separator-safe canonical encoding, что CLI `inputKey`, включая external
  inputs за пределами working directory;
- `reason` рекомендуется и выводится в suppression summary;
- CLI override имеет приоритет над config, config — над preset defaults.

Public schema URL определяется только перед публикацией; до этого schema лежит
в workspace и используется tests/editor fixtures.

## 9. Suppression pipeline

Порядок обработки:

```text
raw findings
  → config severity/options
  → config ignore matching
  → baseline comparison
  → formatter
  → exit policy
```

Report содержит counts:

- `new`;
- `existing`;
- `resolved`;
- `suppressed`;
- `analysisComplete`.

Suppressed finding не попадает в baseline, но учитывается в suppression summary.
Неиспользованный suppression показывается отдельным metadata warning, но не
вводит новый lint rule ID в v0.1.

## 10. Baseline mode

```bash
pptxlint legacy-deck.pptx --write-baseline .pptxlint-baseline.json
pptxlint legacy-deck.pptx --baseline .pptxlint-baseline.json
```

Baseline содержит schema version, tool major version, normalized input key и
finding fingerprints с минимальной location metadata. Он не содержит file bytes
или slide text.

При lint:

- fingerprint есть в baseline → `existing`;
- fingerprint появился впервые → `new`;
- fingerprint был в baseline и исчез → `resolved`.

Только `new` findings участвуют в exit policy. Existing findings отображаются в
summary и доступны в JSON. Baseline с несовместимой major/schema version
отклоняется с code 2, а не молча игнорируется.

## 11. Output formats

### 11.1 Stylish

```text
legacy-deck.pptx

  slide 14 / shapes 18, 22
  warning  layout/text-overlap
  Text boxes overlap by 31% of the smaller box.

  slide 18 / shape 9
  warning  layout/outside-slide
  Shape extends 14pt beyond the right slide edge.

✖ 2 new problems (0 errors, 2 warnings)
  184 existing · 7 resolved · 3 suppressed
```

### 11.2 JSON

JSON имеет versioned schema и содержит tool/config versions, input hashes и
findings по status. Opt-in `--debug` добавляет aggregate context/rule timings и
peak RSS; нестабильные performance measurements не заполняются в default
output. Абсолютные local paths не выводятся по умолчанию; используются paths
относительно current working directory.

### 11.3 SARIF

- SARIF version 2.1.0.
- Каждый rule публикуется в `tool.driver.rules`.
- `.pptx` указывается как `artifactLocation`.
- Slide/shape передаются через `logicalLocations`, message и properties.
- Fingerprint передаётся как partial fingerprint.

Ограничение: PPTX является бинарным artifact, поэтому обычный SARIF не может
дать line-level annotation или изображение слайда. Visual preview/deep link
потребует будущего GitHub Check/App и rendering service.

## 12. Performance и security

- ZIP entries индексируются один раз; XML parts парсятся лениво и кешируются.
- External relationships никогда не fetch-ятся.
- Path traversal, duplicate entry names, DTD/entities и ZIP bombs блокируются.
- Configurable defaults ограничивают entries, declared/actual uncompressed
  bytes, XML part size и compression ratio.
- Benchmark fixture: 50 MiB/100 slides. V0.1 фиксирует измеренные time/peak RSS в
  CI/dev documentation, не обещая одинаковое wall time на всех машинах.

## 13. Acceptance criteria

- `npx pptxlint generated.pptx` или эквивалентная packed CLI-команда работает на
  clean install и возвращает code 0/1/2 по контракту.
- Все десять rules имеют positive, negative и malformed-prerequisite fixtures.
- Missing media не дублируется как broken relationship.
- Autofit rules не выдают вычисленный размер без persisted scale.
- Intentional overlap подавляется точным config suppression.
- Baseline различает new/existing/resolved и ломает CI только на новых gating
  findings.
- Stylish, JSON и SARIF outputs проходят snapshot/schema tests.
- Findings и fingerprints детерминированы.
- Core/CLI работают без PowerPoint, LibreOffice, network и system-font scan.
- Tests, lint, typecheck, build и packed-package smoke проходят в CI.

## 14. После v0.1

Приоритет определяется реальными deck fixtures и usage, а не количеством rules:

1. GitHub Action/Check с удобными PR summaries;
2. safe `--fix` для строго доказуемых изменений;
3. optional rendering и slide thumbnails;
4. visual baseline/diff;
5. organization policies и hosted history;
6. REST API/web dashboard как часть платной инфраструктуры.
