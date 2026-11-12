# Startup / lazy-loading benchmark

## Result

Baseline: `870a977f9b0d1cf73ca5cf7f6bc3eaf4dcfd5784` (unmodified v0.4.4 source).
Optimized: the working tree on `fix/load-speed` containing `provider/lazy-runtime.ts`
and `provider/runtime.ts`.
Environment: Pi **1.5.0**, Node **v26.13.0**, macOS / Apple Silicon (`Darwin arm64`).

Nine measured samples per condition, after one excluded warmup. Medians:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Extension import + factory (`PI_TIMING`) | 183 ms | 11 ms | **172 ms / 94.0% less** |
| Process spawn → successful RPC `get_state` | 367.12 ms | 190.60 ms | **176.52 ms / 48.1% less** |
| First local Cursor request → missing-key error | 0.294 ms | 178.70 ms | Deferred loading is now paid here |
| Second local Cursor request → missing-key error | 0.017 ms | 0.023 ms | No repeat import; both below 0.03 ms |

Import + factory ranges: **166–190 ms before**, **10–16 ms after**.
RPC readiness ranges: **349.41–380.98 ms before**, **186.52–221.60 ms after**.

Raw samples, summary statistics, and environment information: [`results.json`](results.json).
Package paths in the JSON use neutral labels rather than local absolute paths.
The benchmark output directory also contains per-process stdout/stderr logs, which
may include local paths.

### Interpretation and limits

- This optimizes startup, especially sessions that never call Cursor. It moves work
  to the first Cursor request; it does **not** eliminate that work or demonstrate
  improved server-side response time / LLM TTFT.
- `startup.py` invokes the real installed Pi CLI in RPC mode, with only the target
  extension enabled. It does **not** measure the user's complete extension set,
  interactive TUI initialization, or background MCP readiness.
- Startup and request probes use separate child processes. The request probe wraps
  provider registration to obtain its original `streamSimple`; it then invokes it
  twice **without an API key**. Both calls must end in the expected missing-key
  error, before network I/O. This exercises real module loading and local error
  handling, not a successful Cursor conversation.
- Each process has a disposable agent directory, no credentials, and a fresh
  single-model cache. User settings, installed package declarations, authentication,
  and real caches are not changed. `CURSOR_ACCESS_TOKEN` is removed from the child
  environment. Pi is started offline.
- The baseline and optimized directories share the same dependency tree. Samples
  are sequential, the before/after order alternates, and each condition has one
  excluded warmup. OS, Node, and Jiti disk caches are **not** cleared. These are
  warm-disk / fresh-process results, not controlled cold-cache results.
- `PI_TIMING` has 1 ms resolution. Sub-millisecond request numbers are descriptive,
  not evidence of a meaningful difference between the two second-call timings.
- The older installed-package measurement of 153 ms used a different load order and
  shared imports; it is not the baseline of this experiment. AiService's individual
  contribution is not separated from the rest of the graph here.

## Reproduce

From the repository root, install the package's development dependencies:

```sh
cd pi-cursor-agent
npm ci
npm test
npm run typecheck
npm run lint
cd ..
```

Export the baseline without checking out another branch or changing your worktree.
Use a new temporary directory; the dependency symlink is local test infrastructure,
not part of the package or the Git installation process:

```sh
BASELINE_DIR="$(mktemp -d /tmp/pi-cursor-before.XXXXXX)"
git archive 870a977f9b0d1cf73ca5cf7f6bc3eaf4dcfd5784 pi-cursor-agent \
  | tar -x -C "$BASELINE_DIR" --strip-components=1
ln -s "$PWD/pi-cursor-agent/node_modules" "$BASELINE_DIR/node_modules"

python3 pi-cursor-agent/bench/startup.py \
  --before "$BASELINE_DIR" \
  --after pi-cursor-agent \
  --runs 9 \
  --output /tmp/pi-cursor-load-speed-results
```

`pi` must be on `PATH`; use `--pi /absolute/path/to/pi` to select a specific CLI.
No benchmark is run automatically during ordinary package loading or `npm test`.

## Regression coverage

`npm test` includes:

- fresh cache: no service factory invocation; stale/missing/invalid cache: refresh;
- concurrent refresh: one service load/construction/fetch; retry after failure;
- a subprocess import guard proving registration and startup/model/tree/tool/shutdown
  hooks do not import the execution, service, vendor, or generated-protobuf graph
  when the cache is fresh (including when a token is available);
- synchronous stream return, unchanged event/result forwarding, tool-use continuation;
- shared first-load initialization, latest-branch restoration, failed-load retry;
- lifecycle load/restore failure isolation, with request errors and retries preserved;
- cancellation before/during import, session changes and shutdown during import;
- real checkpoint/tool-metadata restoration, previous live-session termination,
  pending-tool rejection, and shutdown cleanup in isolated cache directories.

The import-guard test uses Node's `module.registerHooks` (Node 22.15+ / 24+).
No test uses actual Cursor credentials or sends a Cursor API request.
