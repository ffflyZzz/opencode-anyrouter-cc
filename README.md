# opencode-anyrouter-cc

An [OpenCode](https://opencode.ai) plugin for using [AnyRouter](https://anyrouter.top) as a Claude API provider with OpenCode.

OpenCode sends tool names in lowercase (e.g. `todowrite`, `webfetch`), which causes compatibility issues when using AnyRouter's Claude API. This plugin transparently converts tool names to PascalCase and fixes array serialization problems, making OpenCode work seamlessly with AnyRouter.

## Problems Solved

### 1. Tool Name Casing

OpenCode uses lowercase tool names, but AnyRouter's Claude API requires correct casing. This plugin converts them automatically:

| OpenCode (lowercase) | Converted (PascalCase) |
|---------------------|------------------------|
| `todowrite` | `TodoWrite` |
| `webfetch` | `WebFetch` |
| `google_search` | `Google_Search` |
| Other names | First letter capitalized |

Transformation covers:
- **Request body**: `tools[].name` and `messages[].content[].name` (tool_use blocks)
- **Response body**: `content[].name` (tool_use blocks)
- **SSE stream**: `content_block_start` events with `tool_use` type

### 2. Array Serialization Fix

Fixes an issue where arrays/objects in `tool_use` input fields are serialized as JSON strings. The plugin detects string values starting with `[` or `{` and parses them back to proper JSON objects.

## Installation

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.2
- [OpenCode](https://opencode.ai)

### Option 1: Local Link (Recommended for Development)

```bash
git clone <repo-url> opencode-anyrouter-cc
cd opencode-anyrouter-cc
bun install
mise run build
mise run link
```

This creates a symlink at `~/.config/opencode/plugin/opencode-anyrouter-cc.js`.

### Option 2: Global Plugin Directory

```bash
bun install
mise run build
cp dist/index.js ~/.config/opencode/plugins/opencode-anyrouter-cc.js
```

### Option 3: npm Package (After Publishing)

Add to your project's `opencode.json`:

```json
{
  "plugin": ["opencode-anyrouter-cc"]
}
```

Or install globally in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-anyrouter-cc"]
}
```

## OpenCode Configuration for AnyRouter

Use either project-level `opencode.json` or global `~/.config/opencode/opencode.json`.

### Minimal working config

```json
{
  "plugin": [
    "opencode-anyrouter-cc"
  ],
  "anthropic": {
    "options": {
      "baseURL": "https://anyrouter.top/v1",
      "apiKey": "sk-",
      "headers": { "Authorization": "Bearer sk-" }
    }
  }
}
```

### Full config example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-anyrouter-cc"
  ],
  "anthropic": {
    "options": {
      "baseURL": "https://anyrouter.top/v1",
      "apiKey": "sk-your-anyrouter-key",
      "headers": {
        "Authorization": "Bearer sk-your-anyrouter-key"
      }
    }
  }
}
```

> If you use a local plugin file, replace `"opencode-anyrouter-cc"` with your relative path (for example `"./opencode-anthropic-tool-name-transformer.mjs"`).

## Development

```bash
bun install          # Install dependencies
mise run build       # Build the plugin
mise run test        # Run tests
mise run link        # Symlink to OpenCode plugin dir
```

## How It Works

The plugin monkey-patches `globalThis.fetch` at initialization time. It only intercepts requests to URLs containing `/v1/messages` (the Anthropic Messages API endpoint). All other requests pass through unchanged.

```
Request flow:
  OpenCode (lowercase) -> patchedFetch (PascalCase) -> AnyRouter API
                                                            |
  OpenCode <- transformResponse/SSE <-----------------------+
```

## License

MIT
