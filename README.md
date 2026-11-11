# dsh-rea

A DSH bundle that puts the whole Reverse Engineer Anything (REA) stack — the `rea`
MCP tool server **and** the `reverse-engineer-anything` skill — behind one toggle in
the Plugins manager, pre-trimmed so enabling it never floods your context.

[REA](https://www.npmjs.com/package/rea-agents) turns Ghidra (and friends) into agent
tools for reverse engineering. Out of the box its MCP server advertises **229 tools
(~302 KB ≈ 75k tokens)** to every session. This bundle starts it through a vendored
filtering proxy instead, so you get the same capability for a few thousand tokens.

## What you get

| Row id | Plugin | What it adds |
| --- | --- | --- |
| `rea-mcp` | `@deepseek-ai/dsh-mcp-client` | The `rea` stdio MCP server, started through `mcp/rea-tool-filter.mjs` — never `rea mcp` directly. You see ~16 curated `mcp__rea__*` tools; `load_rea_tools`/presets pull the rest on demand. |
| `rea-skills` | `@deepseek-ai/dsh-skill-filesystem` | The vendored `reverse-engineer-anything` skill, served from this bundle's `skills/` only (`includeDefaultRoots: false`, `providerName: rea`). |

## Install

1. **Prerequisites** (once per machine, outside DSH): a Ghidra install folder and a
   JDK 21+, plus REA itself:

   ```
   npm i -g rea-agents
   ```

   Tell REA where Ghidra lives — set `GHIDRA_INSTALL_DIR` to the Ghidra folder (or
   use the fallback/edit the knobs below).
2. **Install the bundle** — full CLI command:

   ```
   dsh plugin --profile desktop add @codemody/dsh-rea
   ```

   Or paste `@codemody/dsh-rea` (npm) or `github:CodeMody/dsh-rea` (source)
   into the Plugins manager's install field — like the other bundles here.

3. **Restart the harness**, then start a new session: you should see the
   `mcp__rea__*` tools and the REA skill. Disabling the bundle makes both disappear
   from sessions started afterwards (~8k saved vs. not having REA at all).

> **Note:** like the other bundles here, the patch uses a **literal path into the
> default `desktop` profile** (`…\.dsh\profiles\desktop\node_modules\@codemody\dsh-rea\…`,
> built from `%USERPROFILE%`). If you rename the profile or move `.dsh`, update
> `args` and `bundledSkillDir` in [`cordis.patch.yml`](cordis.patch.yml).

## Machine knobs (point at your own Ghidra)

Every path in `cordis.patch.yml` is a `!!js` expression that prefers a Windows
environment variable and falls back to the literal this bundle was built on — so on a
fresh machine you either set the variable (System → Environment → user variables) or
edit the fallback. Expressions evaluate when the row activates, and editing the row
config in Settings reloads the connection in place.

| Env var | Fallback if unset | Meaning |
| --- | --- | --- |
| `GHIDRA_INSTALL_DIR` | `C:\ghidra_12.1.4_PUBLIC` | **Your Ghidra installation folder** — the main knob |
| `DSH_REA_JAVA_HOME` | `C:\Users\CodeMody Laptop\.jdks\openjdk-26.0.1` | JDK 21+ for REA's Ghidra provider, passed to REA as `JAVA_HOME`. Deliberately *not* the global `JAVA_HOME` — on this machine (and many others) it still points at a JDK 17 that REA cannot use. |
| `REA_FILTER_NODE` | `C:\Program Files\nodejs\node.exe` | Node used for the proxy AND the REA child |
| `REA_FILTER_SCRIPT` | `...\AppData\Roaming\npm\node_modules\rea-agents\scripts\rea.mjs` | Where npm installed `rea-agents` |
| `USERPROFILE` | (always set on Windows) | Builds the `~\.dsh\profiles\desktop\…` paths for `args` and `bundledSkillDir` |

## Context diet (why it stays small)

- The MCP row *is* the proxy, so the plugin can never come back in the unfiltered
  229-tool form. Edit the curated set inside `mcp/rea-tool-filter.mjs`
  (`DEFAULT_TOOLS`, `PRESETS`); a `REA_FILTER_TOOLS` env value overrides it entirely.
- The row pins `REA_ANALYSIS_PROVIDER=ghidra`, the compact input-schema profile, and
  the `off` output-schema profile — they are what keep each schema tiny.
- The numbers (229 tools, REA 6.8.0, skill v49) describe the REA release this bundle
  was cut for; they are documentation, not pinned versions.

## Scope and removal

- The toggle affects sessions started afterwards; existing sessions keep the tool
  catalog they started with.
- **Uninstall**: Plugins → `@codemody/dsh-rea` → uninstall (or `plugin_manager`
  `remove_bundle`). Nothing of the bundle stays behind beyond pnpm's own files.
- History for *this* machine: before the bundle, REA lived in `~\.dsh\cordis.patch.yml`
  (written by `rea setup --client dsh`), `~\.agents\skills\reverse-engineer-anything`,
  and `~\.dsh\rea-tool-filter.mjs`. All three were removed once the bundle took over.
  Do **not** run `rea setup --client dsh` again — it would recreate an unfiltered
  global patch file; if that happens, delete `~\.dsh\cordis.patch.yml` and restart.

## Compatibility

- **DSH:** `0.2.2-rc.1`, Windows `desktop` profile — the patch builds its
  profile paths from `%USERPROFILE%\.dsh\profiles\desktop\…`.
- **Prerequisites:** `rea-agents` on npm (cut for REA 6.8.0), a Ghidra install
  (tested with 12.1.4), and a JDK 21+ — see [Machine knobs](#machine-knobs-point-at-your-own-ghidra).
- **Permissions:** spawns one stdio child process (the filtered `rea` MCP
  server); no network access of its own beyond what REA does.
- **License:** MIT ([LICENSE](LICENSE)); the vendored skill is from
  `rea-agents`, see [Provenance](#provenance).

## Provenance

`skills/reverse-engineer-anything/` (SKILL.md + `references/`) is vendored from the
`rea-agents` package's DSH skill directory (skill version 49) — after a REA upgrade,
re-copy the skill folder if you want the new instructions. The bundle packaging
(patch, proxy, locales, icon) is [MIT licensed](LICENSE).
