/**
 * dsh-rea entry module.
 *
 * The bundle carries no service logic of its own: its rows (`rea-mcp`,
 * `rea-skills`) are declared in `cordis.patch.yml` and run from
 * `@deepseek-ai` packages. This module exists so the package satisfies the
 * DSH plugin entry contract — it exports an `apply(ctx)` plugin module —
 * and as the stable `require`/`import` target for tooling.
 */
export default function apply(ctx) {
  // Nothing to register: the rows are wired entirely through cordis.patch.yml.
}
