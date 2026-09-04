# Security policy

## Supported version

Security fixes are prepared for the current `0.1.x` release line.

## Reporting a vulnerability

Do not include a confidential presentation in a public issue. Report the
smallest synthetic reproducer possible to the repository owner through a
private channel. Include the affected version, platform, observed behavior,
and whether the issue can cause unexpected filesystem/network access or
unbounded resource use.

## Input boundary

PPTX files are untrusted ZIP/XML input. pptxlint processes them locally and
does not fetch external relationship targets. It rejects traversal and
ambiguous part names, DTD/entity declarations, malformed ZIP structures, and
entries outside hard byte/count/compression limits. The default hard ceilings
are documented in [release evidence](docs/release-evidence.md).

These controls reduce risk but are not an operating-system sandbox. Run
pptxlint with the same isolation and resource limits used for other parsers
when accepting files from untrusted users.
