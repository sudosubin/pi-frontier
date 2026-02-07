# pi-cursor-agent

[![npm](https://img.shields.io/npm/v/pi-cursor-agent)](https://www.npmjs.com/package/pi-cursor-agent)

![terminal](./assets/terminal.avif)

Cursor Agent provider extension for [pi](https://github.com/badlogic/pi-mono).

Use [Cursor](https://cursor.com/)'s AI models directly from pi with your existing Cursor subscription. Supports Claude, GPT, Gemini, Grok, and Composer models — including thinking/reasoning variants.

## Models

The following models are available through the Cursor Agent provider. Canonical Model IDs are used in pi, while Cursor Model IDs are the internal identifiers used by the Cursor API. Models with reasoning support automatically switch to thinking variants based on the configured thinking level.

| Canonical Model ID | Cursor Model ID | Name |
| --- | --- | --- |
| `claude-sonnet-4-5` | `claude-4.5-sonnet`, `claude-4.5-sonnet-thinking` | Claude 4.5 Sonnet (Cursor) |
| `claude-opus-4-5` | `claude-4.5-opus-high`, `claude-4.5-opus-high-thinking` | Claude 4.5 Opus (Cursor) |
| `claude-opus-4-6` | `claude-4.6-opus-high`, `claude-4.6-opus-high-thinking` | Claude 4.6 Opus (Cursor) |
| `gpt-5.2` | `gpt-5.2`, `gpt-5.2-high` | GPT-5.2 (Cursor) |
| `gpt-5.1` | `gpt-5.1-high` | GPT-5.1 High (Cursor) |
| `gpt-5.2-codex` | `gpt-5.2-codex`, `gpt-5.2-codex-low`, `gpt-5.2-codex-high`, `gpt-5.2-codex-xhigh` | GPT-5.2 Codex (Cursor) |
| `gpt-5.2-codex-fast` | `gpt-5.2-codex-fast`, `gpt-5.2-codex-low-fast`, `gpt-5.2-codex-high-fast`, `gpt-5.2-codex-xhigh-fast` | GPT-5.2 Codex Fast (Cursor) |
| `gpt-5.1-codex-max` | `gpt-5.1-codex-max`, `gpt-5.1-codex-max-high` | GPT-5.1 Codex Max (Cursor) |
| `gemini-3-pro-preview` | `gemini-3-pro` | Gemini 3 Pro (Cursor) |
| `gemini-3-flash-preview` | `gemini-3-flash` | Gemini 3 Flash (Cursor) |
| `grok-code-fast-1` | `grok-code-fast-1` | Grok (Cursor) |
| `composer-1` | `composer-1` | Composer 1 (Cursor) |

## Installation

```sh
# using git
pi install git:github.com/sudosubin/pi-cursor-agent

# using npm
pi install npm:pi-cursor-agent
```

## Authentication

1. Open pi and enter `/login`.
2. Select **Cursor Agent** from the provider list.
3. A browser window will open to the Cursor login page — sign in with your Cursor account.

## Requirements

* Cursor subscription
* pi >= 0.49.0

## License

MIT
