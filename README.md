# @local/dsh-rea — Reverse Engineer Anything as a DSH plugin

One toggle for the whole REA stack. The bundle inserts two Host rows:

| Row id | Plugin | What it adds |
|---|---|---|
| `rea-mcp` | `@deepseek-ai/dsh-mcp-client` | The `rea` stdio MCP server, started through the vendored filtering proxy `mcp/rea-tool-filter.mjs` — never `rea mcp` directly |
| `rea-skills` | `@deepseek-ai/dsh-skill-filesystem` | The vendored `reverse-engineer-anything` skill, served from this bundle's `skills/` only (`includeDefaultRoots: false`, unique `providerName: rea`) |

Disable the bundle in the Plugins manager and both disappear from sessions started afterwards — the skill-catalog entry and the ~16 advertised MCP tool schemas go away (~8k tokens saved). The MCP row *is* the proxy, so the plugin can never come back in the unfiltered 229-tool (~302 KB / ~75k token) form. Edit the pre-advertised tool set inside `mcp/rea-tool-filter.mjs` (`DEFAULT_TOOLS`, `PRESETS`; a `REA_FILTER_TOOLS` env value overrides it entirely).

## Machine knobs (point at your own Ghidra)

Every path in `cordis.patch.yml` is a `!!js` expression that prefers a Windows environment variable and falls back to the literal this bundle was built on. Set the variable (System → Environment → user variables) to repoint without editing YAML; expressions are evaluated when the row activates, and editing the row config reloads the connection in place:

| Env var | Fallback (this machine) | Meaning |
|---|---|---|
| `GHIDRA_INSTALL_DIR` | `C:\ghidra_12.1.4_PUBLIC` | **Your Ghidra installation folder** — the main knob |
| `DSH_REA_JAVA_HOME` | `C:\Users\CodeMody Laptop\.jdks\openjdk-26.0.1` | JDK 21+ for REA's Ghidra provider; deliberately *not* the global `JAVA_HOME`, which on this machine (and many others) still points at a JDK 17 that REA cannot use. The value is passed to REA as `JAVA_HOME`. |
| `REA_FILTER_NODE` | `C:\Program Files\nodejs\node.exe` | Node used for the proxy AND the REA child |
| `REA_FILTER_SCRIPT` | `...\AppData\Roaming\npm\node_modules\rea-agents\scripts\rea.mjs` | Where npm installed `rea-agents` |
| `USERPROFILE` | (always set on Windows) | Builds the `~\.dsh\profiles\desktop\...` paths for `args` and `bundledSkillDir` |

`REA_ANALYSIS_PROVIDER=ghidra`, the compact input schema profile, and the off output schema profile stay pinned — they are what keeps the context small.

## Pushing to GitHub / installing on another machine

This folder is the whole project; the harness installs it as a *linked* directory
(`.dsh\profiles\desktop\node_modules\@local\dsh-rea` → this checkout), so edits
apply without reinstalling — patch/YAML changes take effect at the next harness
restart. To install elsewhere: clone the repo, point the plugin manager
(`install_bundle`) at the clone, restart, and make sure `rea-agents`
(`npm i -g rea-agents`), Ghidra, and a JDK 21+ exist — or export the env vars
above. The numbers (229 tools, 6.8.0, skill v49) describe the REA release this
bundle was cut for; they are documentation, not pinned versions.

## Requirements outside this bundle

- `rea-agents` installed for npm; Node on the machine; Ghidra + JDK 21+ for the Ghidra provider (Windows Ghidra is REA's experimental P0 transport).
- A DSH profile laid out at `%USERPROFILE%\.dsh\profiles\desktop` (the default desktop layout) — `args` and `bundledSkillDir` follow that assumption.

## History: what this bundle replaced

Before this bundle existed, the same two rows lived in two user files:

- `C:\Users\CodeMody Laptop\.dsh\cordis.patch.yml` (REA MCP registration written by `rea setup --client dsh`) — renamed to `cordis.patch.yml.pre-plugin` when this bundle took over. If `rea setup --client dsh` ever rewrites that file, the unfiltered 229-tool catalog returns; fix it by renaming the file away again or editing its `args` to point at the proxy.
- `C:\Users\CodeMody Laptop\.agents\skills\reverse-engineer-anything` — moved to `C:\Users\CodeMody Laptop\.dsh\rea-skill-backup\` so the *default* filesystem skill scan no longer advertises REA when the bundle is disabled.
- `C:\Users\CodeMody Laptop\.dsh\rea-tool-filter.mjs` — the original proxy, copied into `mcp/` in v1.1.0 and renamed to `rea-tool-filter.mjs.pre-plugin` so only the bundle copy is ever edited.

## Vendored skill

`skills/reverse-engineer-anything/` (SKILL.md + references/) was vendored from the installed `rea-agents` package's DSH skill directory (skill version 49). After a REA upgrade, re-copy the skill folder if you want the new instructions, or bump the bundle version in the plugin manager.
