# ADR 0001: ZIP and XML adapter libraries

- Status: Accepted
- Date: 2026-08-28
- Scope: PR 02

## Context

PPTX input is untrusted ZIP/XML. Rule and presentation code must not depend on a
third-party parser API, duplicate ZIP names must remain visible, entry bodies
must stay lazy, and malformed XML or archives must become typed diagnostics.
DTD and custom entities are not needed by OOXML and must never trigger local or
network resolution.

## Decision

Use `@zip.js/zip.js` 2.8.28 (BSD-3-Clause) behind
`packages/core/src/archive/`.

- `ZipReader` reads the central directory from a `Uint8Array` and retains every
  entry in order.
- The adapter uses balanced archive enumeration so duplicate names remain
  observable instead of being rejected or overwritten.
- Before enumeration, the adapter independently checks EOCD/ZIP64 records,
  central-directory boundaries, and the actual number of file headers. This
  keeps visible duplicates while rejecting entries hidden by understated EOCD
  counts.
- Entry payloads are read and cached only through `ZipEntryDescriptor.read()`.
- Reads enable CRC signature, overlapping-entry, and central/local-header
  ambiguity checks. Open/read/closed failures are returned as diagnostics.
- Declared compressed/uncompressed sizes, CRC, compression method, encryption,
  and raw filename bytes remain available to the next package-model layer.

Use `@rgrove/parse-xml` 4.2.0 (ISC) behind `packages/core/src/xml/`.

- It performs strict XML 1.0 parsing and returns a typed object tree.
- The adapter does not provide an entity resolver and rejects `DOCTYPE` before
  parsing. A preserved-document-type check provides a second guard.
- The adapter resolves namespace declarations itself and exposes element and
  attribute names as namespace URI, local name, prefix, and qualified name.
- QName prefixes and local names are validated against the XML Namespaces 1.0
  `NCName` grammar, including Unicode name ranges and `xmlns:*` declarations.
- Unknown elements, attributes, text, CDATA, comments, and processing
  instructions remain readable in the adapter tree.
- UTF-8 and BOM/signature-detected UTF-16 input bytes are supported. An XML
  encoding declaration must name a supported encoding and match the detected
  bytes. Decode, malformedness, and namespace errors are returned as typed
  diagnostics.

Versions are pinned through the pnpm workspace catalog. Only adapter modules may
import these libraries.

## Alternatives considered

- JSZip: convenient but its filename-keyed object model is a poor contract for
  security decisions around duplicate names.
- yauzl: provides central-directory and lazy-stream semantics, but would expose
  more Node callback/stream and `Buffer` details inside core.
- saxes: strict and namespace-aware, but requires building the full tree and its
  upstream repository is archived.
- DOM-style XML parsers: convenient query APIs, but several recover from
  malformed XML; strict failure is required here.

## Consequences

- Core's TypeScript build includes DOM library types because zip.js uses the
  standard Web Streams declarations implemented by Node 22.
- ZIP entry count and total/individual size budgets remain the responsibility of
  `ArchiveIndex` in PR 03. The low-level adapter exposes the metadata needed to
  enforce those limits before decompression.
- Parser-specific objects do not escape the adapters, so either dependency can
  be replaced by rerunning the contract tests.
