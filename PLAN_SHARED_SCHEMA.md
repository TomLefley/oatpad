# Plan — Shared `.oats` schema between `mcp/` and `src-web/`

## Goal

Introduce a single source of truth for the `.oats` file shape and event
catalogue, imported (or generated into) both `src-web/lib/` (Vite/Svelte
runtime) and `mcp/src/` (Node MCP server runtime), so the two readers
cannot drift.

## Why

Today, adding or renaming an `OatsEvent` variant requires editing four
files independently:

- `src-web/lib/types.ts` — the canonical TypeScript discriminated union.
- `src-web/lib/file.ts` — the parser/validator (rejects unknown event
  type names — see the regression test at `file.test.ts:83` for the
  `note_edited` → `note_updated` rename).
- `src-web/lib/reducer.ts` — the replay logic.
- `mcp/src/meetings.ts` — the parallel reader for the MCP server.

Forgetting any one of those is silent: the MCP server simply skips the
new variant when projecting summaries, or `file.ts` rejects valid files
written by a newer build. The recent `note_edited` / `note_updated` doc
drift in the README (which sat stale until §1.1 of the review caught it)
is the same shape of problem one level up.

## Approach options

The plan deliberately doesn't pick one — try option 1 first, fall back if
the tooling fights you.

1. **Shared TypeScript file.** A `shared/oats-format.ts` (name TBD) that
   both packages import via relative paths. Vite resolves cross-directory
   imports without ceremony; Node `tsc` does too if `tsconfig.json` and
   `mcp/tsconfig.json` are wired correctly. Lowest ceremony, no codegen.
2. **Generated types from JSON Schema.** A `shared/oats-format.schema.json`
   plus a build step that emits TypeScript declarations into both
   packages. Adds a dependency and a build step but earns runtime
   validation (e.g. via `ajv`) for free. Worth it only if you also want
   to tighten the parser at the boundary.
3. **Hand-written shape + runtime assertion.** A small file with the
   shape declared once and an `assertOatsFile()` helper called by both
   packages at the parse boundary. No codegen, but no mechanical
   guarantee that the assertion stays in sync with the type — the
   discriminated-union exhaustiveness test (see step 4 below) covers
   that gap if you go this route.

Option 1 is the suggested starting point. If you find yourself yak-
shaving the build to make it work, fall back to option 3.

## Constraints

- `mcp` is a separate Node runtime built with `tsc`. Its
  `manifest.json:14` points at `server/index.js` (the build output).
  The shared file must compile under Node-style resolution into the
  same `server/` output.
- `src-web` is bundled by Vite. The shared file must be importable
  without publishing it as a separate package or introducing a workspace
  setup unless you genuinely need one.
- `mcp/.gitignore` excludes `server/` (the build output). Don't disturb
  that.
- Both packages run vitest; the shared file must be importable by both
  test runners.
- `mcp/src/meetings.ts:23` does `JSON.parse(JSON.stringify(file))` on
  purpose to detach Svelte 5 proxies before reading. The comment there
  documents why. Preserve that behaviour at the parse boundary; don't
  drop it when consolidating.

## Concrete steps

1. Audit the four touchpoints. Confirm the `OatsEvent` union, the
   `OatsFile` shape, and the validation rules are consistent across:
   - `src-web/lib/types.ts:1-42`
   - `src-web/lib/file.ts` (look for the `kind` / `type` checks)
   - `src-web/lib/reducer.ts` (the `replay` switch)
   - `mcp/src/meetings.ts` (its own parse + projection)
2. Pick a layout. A `shared/` directory at the repo root is the obvious
   home; both `tsconfig.json` and `mcp/tsconfig.json` would need to
   include or reference it. Confirm `tsc` and Vite both resolve it
   before moving any code.
3. Move the canonical types there. Update both packages' imports.
   Keep the surface narrow: only the on-disk schema (`OatsFile`,
   `OatsEvent` and its variants, `QuillDelta`/`QuillDeltaOp` if
   they're part of the file format). Things like `Paragraph` are
   in-memory shapes and don't need sharing.
4. Add an exhaustive-match unit test in *both* packages that switches
   over `OatsEvent.type` and TypeScript-fails (`never`-narrowing) when
   a new variant lands but isn't handled. This is the lint that earns
   its keep — the whole point of consolidation is to make divergence
   a build error.
5. Run the full verification matrix (see below).

## Verification

- `npm test` and `cd mcp && npm test` — both green.
- `npm run check` — svelte-check clean.
- `just build-web` — the web build still produces a `dist/`.
- `just build-mcpb` — the MCP bundle still packs (~2.7MB).
- A negative test: temporarily add a new variant to the shared union
  *without* updating one of the package's exhaustive switches, and
  confirm the build fails. Revert.

## Pitfalls

- The MCP runtime currently does its own appdata path resolution
  (`mcp/src/meetings.ts`). That's a runtime concern, not a schema
  concern. Don't fold it into the shared module.
- The native side does its appdata path resolution in Rust
  (`src/src/lib.rs`). Out of scope here.
- `OatsFile.snapshot` is typed as `QuillDelta` and is essentially
  opaque to the MCP server (it reads events, not the snapshot, for
  projections). Decide whether `QuillDelta` belongs in the shared
  schema; if the MCP side never inspects its internals, you can keep
  the type exported but treated as opaque (`unknown`-ish) on that
  side.
- The schema move shouldn't change runtime behaviour — both readers
  should accept the same files they accepted before, and reject the
  same files. If you find a behaviour delta during the audit (step 1),
  surface it as a separate fix; don't fold it into this PR.

## Out of scope

- Changing the `.oats` format itself (versioning, new fields).
- Splitting `store.svelte.ts` into native/web modules (REVIEW §2.6) —
  that's an in-memory store concern, not a file-format concern.
- The SPEC §4 recording-id requirement (REVIEW §1.6) — that's a
  format change, addressed separately.

## Starting point for the agent

Files to read first:

- `src-web/lib/types.ts`
- `src-web/lib/file.ts` and `src-web/lib/file.test.ts`
- `src-web/lib/reducer.ts` and `src-web/lib/reducer.test.ts`
- `mcp/src/meetings.ts` and `mcp/src/meetings.test.ts`
- `tsconfig.json` and `mcp/tsconfig.json`
- `vite.config.ts`
- `REVIEW.md` §2.8 — the original review framing.
