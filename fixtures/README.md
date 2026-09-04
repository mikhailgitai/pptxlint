# Synthetic fixtures

- `builders/` contains the deterministic `buildMinimalPptx()` and low-level
  `buildRawZip()` helpers. Tests can replace slide XML, append duplicate part
  names, understate EOCD entry counts, corrupt CRC/header fields, or truncate
  the resulting ZIP without committing opaque binaries.
- `templates/` contains small, non-proprietary fixture inputs.
- `generated/` contains reproducible outputs and is ignored except for its
  placeholder.

Real or proprietary decks must not be committed here.
