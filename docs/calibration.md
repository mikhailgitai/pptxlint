# Real-deck calibration gate for v0.1

The default error-level layout rules require a manually labelled private
corpus before `0.1.0` can be called a final release. Synthetic fixtures do not
count toward this gate.

## Corpus contract

- At least 30 decks and three independent source families.
- Include python-pptx, PptxGenJS, and PowerPoint-authored/template-based output
  where possible.
- Do not copy proprietary decks, extracted text, customer names, absolute
  paths, or source hashes into this repository.
- Label every `layout/text-overlap` and `layout/text-occluded` finding as true
  positive, false positive, or excluded/uncertain with a short rationale.
- Keep the private deck-to-label mapping outside the repository.

The checked-in aggregate must contain only source-family counts and, per rule,
true-positive/false-positive/uncertain counts. Precision is calculated as
`TP / (TP + FP)`; uncertain labels are reported but excluded from the ratio.
Both default error-level layout rules must reach at least 90% precision. A rule
that misses the target must be narrowed, have its threshold adjusted with new
negative fixtures, or be lowered to warning/off before release.

## v0.1 result

The private review was completed on 2026-08-31 for 388 findings across 30
decks and four source families. The anonymous result is checked in as
[calibration-aggregate.json](calibration-aggregate.json); the private
deck-to-label mapping remains outside the repository.

- `layout/text-overlap`: 145 TP, 190 FP, 0 uncertain; precision 43.3%. The
  default was lowered from error to warning.
- `layout/text-occluded`: 0 TP, 53 FP, 0 uncertain; precision 0%. The rule was
  disabled by default and remains available by explicit configuration.

Changing only the area thresholds could not distinguish the dominant false
positive classes: large text frames with visually separate glyphs, intentional
nested labels, buttons, footers, and title/subtitle compositions. Renderer- or
font-metric-based glyph occupancy remains outside v0.1 scope. The release
criterion is satisfied through the documented downgrade/off path; neither
below-target rule remains a default error.

## Aggregate template

```json
{
  "schemaVersion": 1,
  "deckCount": 30,
  "sourceFamilies": {
    "python-pptx": 10,
    "pptxgenjs": 10,
    "powerpoint-template": 10
  },
  "rules": {
    "layout/text-overlap": {
      "truePositive": 0,
      "falsePositive": 0,
      "uncertain": 0,
      "precision": null
    },
    "layout/text-occluded": {
      "truePositive": 0,
      "falsePositive": 0,
      "uncertain": 0,
      "precision": null
    }
  }
}
```

The zero-valued template is not evidence. Release evidence must state who
reviewed the findings, the tool version, the review date, aggregate counts,
threshold decisions, and known blind spots.
