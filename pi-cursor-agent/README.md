# pi-cursor-agent

[![npm](https://badgen.net/npm/v/pi-cursor-agent)](https://www.npmjs.com/package/pi-cursor-agent)
[![cursor-cli](https://badgen.net/static/cursor-cli/2026.01.17-d239e66/gray)](https://cursor.com/cli)

![terminal](./assets/terminal.avif)

Cursor Agent provider extension for [pi](https://github.com/badlogic/pi-mono).

Use [Cursor](https://cursor.com/)'s AI models directly from pi with your existing Cursor subscription. Supports Claude, GPT, Gemini, Grok, Composer, and Kimi models — including thinking/reasoning variants.

## Models

The following models are available through the Cursor Agent provider. Canonical Model IDs are used in pi, while Cursor Model IDs are the internal identifiers used by the Cursor API. Model families with multiple Cursor reasoning variants automatically switch to the appropriate Cursor model ID based on the configured thinking level.

| Canonical Model ID | Cursor Model ID | Name |
| --- | --- | --- |
| `claude-sonnet-4-0` | `claude-4-sonnet`, `claude-4-sonnet-thinking` | Claude 4 Sonnet (Cursor) |
| `claude-sonnet-4-1m` | `claude-4-sonnet-1m`, `claude-4-sonnet-1m-thinking` | Claude 4 Sonnet 1M (Cursor) |
| `claude-sonnet-4-5` | `claude-4.5-sonnet`, `claude-4.5-sonnet-thinking` | Claude 4.5 Sonnet (Cursor) |
| `claude-sonnet-4-6` | `claude-4.6-sonnet-medium`, `claude-4.6-sonnet-medium-thinking` | Claude 4.6 Sonnet (Cursor) |
| `claude-opus-4-5` | `claude-4.5-opus-high`, `claude-4.5-opus-high-thinking` | Claude 4.5 Opus (Cursor) |
| `claude-opus-4-6` | `claude-4.6-opus-high`, `claude-4.6-opus-high-thinking` | Claude 4.6 Opus (Cursor) |
| `claude-opus-4-6-max` | `claude-4.6-opus-max`, `claude-4.6-opus-max-thinking` | Claude 4.6 Opus Max (Cursor) |
| `gpt-5-mini` | `gpt-5-mini` | GPT-5 Mini (Cursor) |
| `gpt-5.1` | `gpt-5.1`, `gpt-5.1-low`, `gpt-5.1-high` | GPT-5.1 (Cursor) |
| `gpt-5.1-codex-mini` | `gpt-5.1-codex-mini`, `gpt-5.1-codex-mini-low`, `gpt-5.1-codex-mini-high` | GPT-5.1 Codex Mini (Cursor) |
| `gpt-5.1-codex-max` | `gpt-5.1-codex-max-medium`, `gpt-5.1-codex-max-low`, `gpt-5.1-codex-max-high`, `gpt-5.1-codex-max-xhigh` | GPT-5.1 Codex Max (Cursor) |
| `gpt-5.1-codex-max-fast` | `gpt-5.1-codex-max-medium-fast`, `gpt-5.1-codex-max-low-fast`, `gpt-5.1-codex-max-high-fast`, `gpt-5.1-codex-max-xhigh-fast` | GPT-5.1 Codex Max Fast (Cursor) |
| `gpt-5.2` | `gpt-5.2`, `gpt-5.2-low`, `gpt-5.2-high`, `gpt-5.2-xhigh` | GPT-5.2 (Cursor) |
| `gpt-5.2-fast` | `gpt-5.2-fast`, `gpt-5.2-low-fast`, `gpt-5.2-high-fast`, `gpt-5.2-xhigh-fast` | GPT-5.2 Fast (Cursor) |
| `gpt-5.2-codex` | `gpt-5.2-codex`, `gpt-5.2-codex-low`, `gpt-5.2-codex-high`, `gpt-5.2-codex-xhigh` | GPT-5.2 Codex (Cursor) |
| `gpt-5.2-codex-fast` | `gpt-5.2-codex-fast`, `gpt-5.2-codex-low-fast`, `gpt-5.2-codex-high-fast`, `gpt-5.2-codex-xhigh-fast` | GPT-5.2 Codex Fast (Cursor) |
| `gpt-5.3-codex` | `gpt-5.3-codex`, `gpt-5.3-codex-low`, `gpt-5.3-codex-high`, `gpt-5.3-codex-xhigh` | GPT-5.3 Codex (Cursor) |
| `gpt-5.3-codex-fast` | `gpt-5.3-codex-fast`, `gpt-5.3-codex-low-fast`, `gpt-5.3-codex-high-fast`, `gpt-5.3-codex-xhigh-fast` | GPT-5.3 Codex Fast (Cursor) |
| `gpt-5.3-codex-spark` | `gpt-5.3-codex-spark-preview`, `gpt-5.3-codex-spark-preview-low`, `gpt-5.3-codex-spark-preview-high`, `gpt-5.3-codex-spark-preview-xhigh` | GPT-5.3 Codex Spark (Cursor) |
| `gpt-5.4` | `gpt-5.4-medium`, `gpt-5.4-low`, `gpt-5.4-high`, `gpt-5.4-xhigh` | GPT-5.4 (Cursor) |
| `gpt-5.4-fast` | `gpt-5.4-medium-fast`, `gpt-5.4-high-fast`, `gpt-5.4-xhigh-fast` | GPT-5.4 Fast (Cursor) |
| `gpt-5.4-mini` | `gpt-5.4-mini-medium`, `gpt-5.4-mini-none`, `gpt-5.4-mini-low`, `gpt-5.4-mini-high`, `gpt-5.4-mini-xhigh` | GPT-5.4 Mini (Cursor) |
| `gpt-5.4-nano` | `gpt-5.4-nano-medium`, `gpt-5.4-nano-none`, `gpt-5.4-nano-low`, `gpt-5.4-nano-high`, `gpt-5.4-nano-xhigh` | GPT-5.4 Nano (Cursor) |
| `gemini-3-pro-preview` | `gemini-3-pro` | Gemini 3 Pro (Cursor) |
| `gemini-3-flash-preview` | `gemini-3-flash` | Gemini 3 Flash (Cursor) |
| `gemini-3.1-pro-preview` | `gemini-3.1-pro` | Gemini 3.1 Pro (Cursor) |
| `grok-4.20-0309-non-reasoning` | `grok-4-20` | Grok 4.20 (Non-Reasoning) (Cursor) |
| `grok-4.20-0309-reasoning` | `grok-4-20-thinking` | Grok 4.20 (Reasoning) (Cursor) |
| `composer-1.5` | `composer-1.5` | Composer 1.5 (Cursor) |
| `composer-2` | `composer-2` | Composer 2 (Cursor) |
| `composer-2-fast` | `composer-2-fast` | Composer 2 Fast (Cursor) |
| `kimi-k2.5` | `kimi-k2.5` | Kimi K2.5 (Cursor) |

## Startup and model caching

Provider registration and the cached model list are available immediately. The
Cursor execution runtime is loaded only on the first Cursor request, so sessions
using other providers do not pay its import cost. The first Cursor request pays
that deferred initialization cost; later requests reuse the loaded runtime.

The model-discovery service is loaded and constructed only when the model cache
needs refreshing (24-hour TTL, missing/empty cache, or an invalid timestamp). Concurrent
refresh attempts share one service creation and fetch. Existing cached models
remain available while a refresh is pending. When no models are cached, the first
`/login` waits for model discovery (with a 15-second request timeout) before
completing. Model-list refreshes such as `/models` and `/scoped-models` re-read the
cache, so newly discovered models appear without restarting pi or running
`pi update --models`. A discovery failure does not prevent credentials from being
saved.

Session/branch state is restored before the first Cursor request and refreshed on
subsequent session/tree events once the runtime is loaded. Shutdown cleans up a
loaded runtime without loading an unused one.

See [the benchmark report](bench/README.md) for measurements, limitations, and
reproduction instructions.

## Installation

```sh
pi install npm:pi-cursor-agent
```

## Authentication

1. Open pi and enter `/login`.
2. Select **Cursor Agent** from the provider list.
3. A browser window will open to the Cursor login page — sign in with your Cursor account.

## Requirements

- `pi >= 0.52.10`
- Cursor subscription

## License

MIT
