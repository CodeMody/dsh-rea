#!/usr/bin/env node
/**
 * rea-tool-filter — a thin stdio MCP proxy for REA.
 *
 * REA 6.8.0 advertises every one of its ~229 tools on `tools/list`, which costs
 * roughly 75k tokens of tool definitions in every request. This proxy spawns
 * REA, forwards the protocol verbatim, and rewrites only the advertised tool
 * catalog so a small curated set is exposed up front.
 *
 * The model widens the catalog at runtime with `load_rea_tools` (the proxy then
 * emits `notifications/tools/list_changed`, which the DSH MCP client honours by
 * re-reading `tools/list`). `list_rea_tools` browses the full inventory by name
 * without paying for the schemas.
 *
 * `tools/call` is never restricted: anything REA offers can still be called by
 * name, so the filter can only remove clutter, never capability.
 *
 * Configuration (all optional, environment):
 *   REA_FILTER_SCRIPT   absolute path to REA's scripts/rea.mjs
 *   REA_FILTER_NODE     node executable used to launch REA
 *   REA_FILTER_TOOLS    comma-separated tool names advertised up front
 */
import { spawn } from 'node:child_process';

const REA_NODE = process.env.REA_FILTER_NODE || process.execPath;
const REA_SCRIPT =
  process.env.REA_FILTER_SCRIPT ||
  'C:\\Users\\CodeMody Laptop\\AppData\\Roaming\\npm\\node_modules\\rea-agents\\scripts\\rea.mjs';

/**
 * Curated up-front catalog, balanced across the providers that work on this
 * host: Ghidra native analysis, the .NET static provider, and the archive
 * graph. Roughly 5.5k tokens of schemas; everything else in REA's 229-tool
 * catalog loads on demand.
 */
const DEFAULT_TOOLS = [
  // session / triage
  'binary_session',
  'open_binary',
  'close_binary',
  'inspect_artifact',
  // native analysis (Ghidra)
  'analyze_function',
  'procedure_pseudo_code',
  'list_procedures',
  'search_procedures',
  'search_strings',
  'xrefs',
  'read_bytes',
  // managed (.NET)
  'inspect_managed_artifact',
  'inspect_managed_members',
  // JavaScript / Electron is deliberately not preloaded: its single entry
  // point (analyze_javascript_application) is the largest schema in the set.
  // Load it with { presets: ["javascript"] } when a target needs it.
  // evidence
  'get_evidence_bundle',
];

/**
 * Named tool bundles for `load_rea_tools`. Each entry is matched as an exact
 * tool name when one exists, otherwise as a name substring. They exist so the
 * model can widen the catalog by intent ("dotnet", "android") instead of
 * guessing 229 individual names.
 */
const PRESETS = {
  native: [
    'analyze_function',
    'procedure_',
    'list_procedures',
    'search_procedures',
    'list_strings',
    'search_strings',
    'search_bytes',
    'read_bytes',
    'xrefs',
    'decompile_all',
    'address',
    'current_',
    'goto_address',
    'next_address',
    'prev_address',
    'list_names',
    'list_segments',
    'list_documents',
    'resolve_containing_procedure',
    'read_function_instructions',
    'inspect_native_',
    'binary_overview',
    'compare_functions',
    'match_native_functions',
  ],
  dotnet: ['managed'],
  javascript: ['javascript', 'analyze_web_bundle', 'recover_javascript', 'source_location', 'compare_source_to_bundle', 'trace_web_module'],
  electron: ['electron', 'javascript', 'fuses', 'correlate_static_and_runtime'],
  android: ['android', 'apk', 'jadx', 'adb', 'apktool', 'flutter', 'dart'],
  web: ['web_', 'browser', 'screenshot', 'webmcp', 'bundle'],
  firmware: ['firmware', 'binary_entropy', 'devicetree', 'kernel_module'],
  formats: [
    'inspect_go_binary',
    'inspect_rust_binary',
    'inspect_pe_',
    'inspect_elf_notes',
    'inspect_macho',
    'inspect_apk_signature',
    'inspect_wasm_artifact',
    'inspect_sqlite_database',
    'inspect_model_artifact',
    'inspect_gpu_code_objects',
    'inspect_il2cpp_metadata',
    'inspect_erlang_beam',
    'inspect_python_pyc',
    'inspect_apple_ips',
    'inspect_binary_layout',
    'inspect_recorded_crash',
    'inspect_evm_interface',
    'inspect_keyed_archive',
    'inspect_plist',
    'inspect_signature',
  ],
  evidence: ['evidence', 'analysis_view', 'unknown', 'reconstruction', 'bookmark', 'analysis_settings', 'compare_application_versions', 'compare_artifacts'],
  runtime: ['frida', 'process_capture', 'observe_', 'capture_', 'correlate_', 'reconcile_', 'compare_bundles', 'compare_process_captures', 'compare_web_'],
  debug: ['gdb', 'rizin', 'cutter', 'objdump', 'inspect_with_objdump'],
};

const requested = (process.env.REA_FILTER_TOOLS || DEFAULT_TOOLS.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

const LOAD_TOOL = {
  name: 'load_rea_tools',
  description:
    'Advertise more REA tools from its full 229-tool catalog. Use presets for a family, exact names, or a substring. Use list_rea_tools to browse names first. Loaded tools stay advertised for the session.',
  inputSchema: {
    type: 'object',
    properties: {
      presets: {
        type: 'array',
        items: { type: 'string', enum: Object.keys(PRESETS) },
        description: 'Tool families to advertise, e.g. "dotnet", "android", "runtime".',
      },
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exact REA tool names to advertise.',
      },
      contains: {
        type: 'string',
        description: 'Advertise every tool whose name contains this substring.',
      },
      limit: {
        type: 'integer',
        description: 'Cap on tools added by presets/contains. Defaults to 25.',
      },
    },
    additionalProperties: false,
  },
};

const LIST_TOOL = {
  name: 'list_rea_tools',
  description:
    'List names in REA’s full tool catalog without advertising their schemas. Optionally filter by substring. Marks which names are already advertised.',
  inputSchema: {
    type: 'object',
    properties: {
      contains: { type: 'string', description: 'Only names containing this substring.' },
    },
    additionalProperties: false,
  },
};

const advertised = new Set(requested);

/** @type {Array<{name: string}> | null} */
let catalog = null;
let catalogPromise = null;

let resolveReady;
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});
// The readiness gate only avoids racing REA's handshake; it must never hang
// `tools/list`, so stop waiting after a bounded delay.
const readyGuard = setTimeout(() => resolveReady(), 25000);
readyGuard.unref?.();

let internalId = 0;
/** @type {Map<string, (message: any) => void>} */
const internalPending = new Map();
/** @type {Set<any>} */
const initializeIds = new Set();

function sendToClient(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const child = spawn(REA_NODE, [REA_SCRIPT, 'mcp'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  // REA went away: nothing useful is left to serve.
  process.exit(code ?? (signal ? 1 : 0));
});
child.on('error', () => process.exit(1));

function reaRequest(method, params) {
  const id = `filter-${++internalId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      internalPending.delete(id);
      reject(new Error(`REA did not answer ${method} in time`));
    }, 120000);
    internalPending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function ensureCatalog() {
  if (catalog) return catalog;
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    await readyPromise;
    const tools = [];
    let cursor;
    do {
      const message = await reaRequest('tools/list', cursor ? { cursor } : {});
      if (message.error) throw new Error(message.error.message || 'REA tools/list failed');
      tools.push(...(message.result?.tools ?? []));
      cursor = message.result?.nextCursor;
    } while (cursor);
    catalog = tools;
    return tools;
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

/** Exact names, then preset/substring expansion, capped by `limit`. */
function resolveSelection(args) {
  const names = Array.isArray(args?.names) ? args.names.filter((n) => typeof n === 'string') : [];
  const presetIds = Array.isArray(args?.presets) ? args.presets.filter((p) => typeof p === 'string') : [];
  const contains = typeof args?.contains === 'string' ? args.contains.trim() : '';
  const limit = Number.isInteger(args?.limit) && args.limit > 0 ? args.limit : 25;

  const all = catalog ?? [];
  const picked = [];
  const unknownNames = [];
  const unknownPresets = [];

  for (const name of names) {
    if (all.some((tool) => tool.name === name)) {
      if (!picked.includes(name)) picked.push(name);
    } else {
      unknownNames.push(name);
    }
  }

  const patterns = [];
  for (const presetId of presetIds) {
    const patternsForPreset = PRESETS[presetId];
    if (!patternsForPreset) {
      unknownPresets.push(presetId);
      continue;
    }
    patterns.push(...patternsForPreset);
  }
  if (contains) patterns.push(contains);

  let truncated = 0;
  for (const pattern of patterns) {
    const exact = all.find((tool) => tool.name === pattern);
    const matches = exact ? [exact] : all.filter((tool) => tool.name.includes(pattern));
    for (const tool of matches) {
      if (picked.includes(tool.name)) continue;
      if (picked.length >= limit) {
        truncated += 1;
        continue;
      }
      picked.push(tool.name);
    }
  }

  return { picked, unknownNames, unknownPresets, truncated, limit };
}

function advertise(toolNames) {
  const added = [];
  for (const name of toolNames) {
    if (advertised.has(name)) continue;
    advertised.add(name);
    added.push(name);
  }
  if (added.length > 0) {
    sendToClient({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
  }
  return added;
}

async function handleLocalCall(name, id, args) {
  if (name === LIST_TOOL.name) {
    await ensureCatalog();
    const contains = typeof args?.contains === 'string' ? args.contains.trim() : '';
    const matches = catalog.map((tool) => tool.name).filter((toolName) => !contains || toolName.includes(contains));
    const lines = matches.map((toolName) => `${advertised.has(toolName) ? '*' : ' '} ${toolName}`);
    sendToClient({
      jsonrpc: '2.0',
      id,
      result: textResult(
        `${matches.length} of ${catalog.length} REA tools${contains ? ` matching "${contains}"` : ''}.\n` +
          `(*) = already advertised. Load with load_rea_tools (presets: ${Object.keys(PRESETS).join(', ')}).\n\n` +
          lines.join('\n'),
      ),
    });
    return;
  }

  if (name === LOAD_TOOL.name) {
    await ensureCatalog();
    const { picked, unknownNames, unknownPresets, truncated, limit } = resolveSelection(args);
    const added = advertise(picked);

    const lines = [];
    if (added.length > 0) lines.push(`Added ${added.length}: ${added.join(', ')}`);
    else if (picked.length > 0) lines.push('Those tools were already advertised.');
    else lines.push('No matching tool was found.');
    if (truncated > 0) {
      lines.push(`${truncated} further match(es) skipped by the ${limit}-tool limit; raise "limit" to add them.`);
    }
    if (unknownNames.length > 0) lines.push(`Unknown names: ${unknownNames.join(', ')}`);
    if (unknownPresets.length > 0) {
      lines.push(`Unknown presets: ${unknownPresets.join(', ')} (known: ${Object.keys(PRESETS).join(', ')})`);
    }
    lines.push(`Advertised now: ${advertised.size} tool(s).`);
    sendToClient({ jsonrpc: '2.0', id, result: textResult(lines.join('\n')) });
    return;
  }

  sendToClient({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unknown proxy tool: ${name}` },
  });
}

async function handleToolsList(id) {
  const tools = await ensureCatalog();
  const selected = tools.filter((tool) => advertised.has(tool.name));
  sendToClient({
    jsonrpc: '2.0',
    id,
    result: { tools: [...selected, LOAD_TOOL, LIST_TOOL] },
  });
}

async function handleFromClient(message) {
  const { method, id } = message;

  if (method === 'tools/list') {
    try {
      await handleToolsList(id);
    } catch (error) {
      sendToClient({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: String(error?.message ?? error) },
      });
    }
    return;
  }

  if (method === 'tools/call' && (message.params?.name === LOAD_TOOL.name || message.params?.name === LIST_TOOL.name)) {
    try {
      await handleLocalCall(message.params?.name, id, message.params?.arguments);
    } catch (error) {
      sendToClient({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: String(error?.message ?? error) },
      });
    }
    return;
  }

  if (method === 'initialize') initializeIds.add(id);
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

let inBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inBuffer += chunk;
  let index;
  while ((index = inBuffer.indexOf('\n')) >= 0) {
    const line = inBuffer.slice(0, index).trim();
    inBuffer = inBuffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handleFromClient(message).catch(() => {
      // A malformed client message must not take the proxy down.
    });
  }
});
process.stdin.on('end', () => {
  child.stdin.end();
  setTimeout(() => process.exit(0), 200);
});

let outBuffer = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  outBuffer += chunk;
  let index;
  while ((index = outBuffer.indexOf('\n')) >= 0) {
    const line = outBuffer.slice(0, index).trim();
    outBuffer = outBuffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof message.id === 'string' && internalPending.has(message.id)) {
      internalPending.get(message.id)(message);
      internalPending.delete(message.id);
      continue;
    }

    if (initializeIds.has(message.id) && message.result) {
      initializeIds.delete(message.id);
      // The proxy itself emits list_changed, so it must be advertised.
      const tools = message.result.capabilities?.tools ?? {};
      message.result.capabilities = message.result.capabilities ?? {};
      message.result.capabilities.tools = { ...tools, listChanged: true };
      clearTimeout(readyGuard);
      resolveReady();
    }

    sendToClient(message);
  }
});
