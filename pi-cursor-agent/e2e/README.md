# Cursor runtime smoke checks

These checks use the real Pi SDK, registered extension, built-in read/write tools,
OAuth callbacks and Cursor HTTP/2 client. They are opt-in and can consume account
quota. The default `npm test` never calls Cursor or reads real credentials.

## Evidence available for this revision

- Node 24.22.1, Pi SDK 0.52.10 (the locked peer installation), Linux: 79 tests passed, zero failures or skips; typecheck and lint
  passed. The local HTTP/2 test used a real loopback Connect server and verified
  cancellation closes the connection and a subsequent run reconnects.
- `smoke.ts check` passed with no credentials or external requests. It checks SDK
  and extension loading, not a successful Cursor conversation.
- **Not run:** authenticated Cursor replies, live tool execution, actual OAuth
  refresh and fresh-process server-checkpoint continuation. The automated runner
  and manual branch checks below are prepared, not evidence that these passed.
- The historical startup numbers in `../bench/` predate these runtime fixes;
  their missing-key request probe is not authenticated E2E evidence.

## Environment

Use Node 24 and a recorded Pi version (the original benchmark used Pi 1.5.0).
Install this package's locked dependencies with `npm ci`. Record the tested Git
SHA, OS, Node/Pi versions and selected model with the result JSON files. Use the
same versions for a baseline comparison; do not infer a PR regression solely
from a service outage or an account/model entitlement error.

Allow HTTPS to `cursor.com` for login and `api2.cursor.sh` for discovery, token
exchange and HTTP/2 agent streaming. A separate Cursor CLI binary is not required.
Use a dedicated OAuth login in a fresh directory, not a copy of the main agent's
credentials. Refresh can rotate credentials, so keep the updated test directory.
Do not share auth.json, bearer tokens, login URLs, or raw transport logs.

From `pi-cursor-agent/`:

```sh
export PI_CODING_AGENT_DIR="$(mktemp -d /tmp/pi-cursor-e2e.XXXXXX)"
export PI_CURSOR_E2E=1
unset CURSOR_ACCESS_TOKEN
# Optional: choose an entitled canonical model ID instead of the first available.
# export PI_CURSOR_E2E_MODEL=composer-2
npm run test:e2e -- login
npm run test:e2e -- conversation
npm run test:e2e -- resume
npm run test:e2e -- refresh-cold
npm run test:e2e -- refresh-warm
```

Each command is a new process. Login/discovery therefore cannot pre-load the
execution runtime in the conversation or resume process. The runner refuses an
existing non-test agent directory, limits tools to read/write, and uses a fixture
working directory under the test agent directory. `result-<mode>.json` contains
check names and boolean token comparisons, never credential values. These files
are overwritten on a repeat run; preserve copies if comparing revisions.

`npm run test:e2e -- check` verifies the harness without credentials. It requires
an empty/dedicated test directory and the opt-in variable but makes no Cursor
request. It must not be reported as an authenticated E2E pass.

## Acceptance criteria

Each prompt has a 120-second watchdog; cancellation has a 10-second watchdog.
These are smoke-test bounds, not latency promises. A request ending in `stop` is
not sufficient: check actual streamed content or fixture file output as well.

| Check | Condition and expected result | Failure |
| --- | --- | --- |
| First authenticated request | Fresh process, valid OAuth and model cache; receive text deltas and the requested random ACK marker | Empty/incorrect reply, auth/model error, no terminal result or timeout |
| Subsequent streaming | Same process/session; deltas reconstruct the final text for each assistant message | Missing/duplicated text, final-text mismatch, error or hang |
| Tool continuation | Read an undisclosed random nonce from input.txt and write output.txt; actual tool start/end IDs match, file matches and both tools share one LiveSession | No required tool call, duplicate/missing result, wrong output or a replacement run at a tool boundary |
| Session switch/resume | A to B to A in conversation mode; fresh-process resume mode then reads/writes again | Cross-session content, failed restoration, repeated tool execution or failed follow-up |
| Cancellation | Cancel after real text, then at actual tool start; settle and successfully answer the next prompt | Timeout, later tools starting after cancellation, unhandled errors, unusable follow-up |
| Token refresh | Expire only the isolated AuthStorage expiry metadata, before the first request and again after a warm run; use real token exchange, persist result and verify the next request's key equals that result | Refresh loop/failure, old key used, request failure or lost credentials |

For cold/warm refresh, the runner changes local expiry metadata, not the signed
token. This tests the real client refresh path and exchange endpoint. It does not
prove how the server handles a token whose signed expiry has already elapsed.
The warm case makes model discovery stale too; additionally open the model picker
and confirm the refreshed cache remains usable after background discovery ends.

A missing prerequisite is **BLOCKED**. Failure to produce the required tools or
cancellation point is **INCONCLUSIVE**, not a pass (the CLI exits nonzero). A
repeatable assertion/timeout is **FAIL** pending baseline comparison. Only mark
**PASS** for the assertions actually exercised. Raw assertion failures can be
reviewed locally; do not upload full session or credential files automatically.

## Manual branch and cancellation checks

The SDK runner covers session switching and restart, but it does not assert every
interactive tree operation. With the same dedicated agent directory and extension
in Pi, select a saved branch *before* the read/write operation, then send another
Cursor request. Confirm only that branch's state is used and excluded tool calls
are not replayed. Repeat after restarting Pi. Inspect the selected session's
`pi-cursor-agent:state` entry and matching cached root blob/agent ID; remembering a
nonce alone could also result from Pi's ordinary message reconstruction.

During a long reply or pending tool, use Pi's normal cancel/switch controls.
Confirm no new tools start after cancellation, no old checkpoint is appended to
the newly selected branch, and the next prompt succeeds. Completed file writes
are not rolled back. Client connection closure is observable; server-side compute
cessation is not established without server evidence.

If a check fails, retain the sanitized result and repeat on the unmodified base
`870a977f9b0d1cf73ca5cf7f6bc3eaf4dcfd5784` with the same environment. Label failures
also present there as existing behavior. The base does not contain this harness;
use a separate export/harness copy, not a branch reset of the work under review.
