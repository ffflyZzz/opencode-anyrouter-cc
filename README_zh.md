# opencode-anyrouter-cc

一个 [OpenCode](https://opencode.ai) 插件，用于让 OpenCode 能够通过 [AnyRouter](https://anyrouter.top) 使用 Claude API。

OpenCode 发送的工具名称是小写的（如 `todowrite`、`webfetch`），这在使用 AnyRouter 的 Claude API 时会产生兼容性问题。本插件透明地将工具名转换为 PascalCase 并修复数组序列化问题，使 OpenCode 能正常配合 AnyRouter 使用。

## 解决的问题

### 1. 工具名称大小写

OpenCode 使用小写的工具名，但 AnyRouter 的 Claude API 需要正确的大小写格式。本插件自动完成转换：

| OpenCode（小写） | 转换后（PascalCase） |
|-----------------|---------------------|
| `todowrite` | `TodoWrite` |
| `webfetch` | `WebFetch` |
| `google_search` | `Google_Search` |
| 其他名称 | 首字母大写 |

转换覆盖范围：
- **请求体**：`tools[].name` 和 `messages[].content[].name`（tool_use 块）
- **响应体**：`content[].name`（tool_use 块）
- **SSE 流**：`content_block_start` 事件中的 `tool_use` 类型

### 2. 数组序列化修复

修复 `tool_use` 输入字段中数组/对象被序列化为 JSON 字符串的问题。插件会检测以 `[` 或 `{` 开头的字符串值，将其解析回正确的 JSON 对象。

## 安装

### 前置条件

- [Bun](https://bun.sh) >= 1.3.2
- [OpenCode](https://opencode.ai)

### 方式一：本地链接（开发推荐）

```bash
git clone <repo-url> opencode-anyrouter-cc
cd opencode-anyrouter-cc
bun install
mise run build
mise run link
```

这会在 `~/.config/opencode/plugin/opencode-anyrouter-cc.js` 创建符号链接。

### 方式二：全局插件目录

```bash
bun install
mise run build
cp dist/index.js ~/.config/opencode/plugins/opencode-anyrouter-cc.js
```

### 方式三：npm 包（发布后）

在项目的 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-anyrouter-cc"]
}
```

或在全局配置 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugin": ["opencode-anyrouter-cc"]
}
```

## AnyRouter 接入配置（OpenCode）

可配置在项目级 `opencode.json`，或全局 `~/.config/opencode/opencode.json`。

### 最小可用配置

```json
{
  "plugin": [
    "./opencode-anthropic-tool-name-transformer.mjs"
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

### 完整配置示例

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

> 如果你使用本地插件文件，请将 `"opencode-anyrouter-cc"` 替换为你的相对路径（例如 `"./opencode-anthropic-tool-name-transformer.mjs"`）。

## 开发

```bash
bun install          # 安装依赖
mise run build       # 构建插件
mise run test        # 运行测试
mise run link        # 符号链接到 OpenCode 插件目录
```

## 工作原理

插件在初始化时 monkey-patch `globalThis.fetch`，仅拦截 URL 包含 `/v1/messages`（Anthropic Messages API 端点）的请求，其他请求原样透传。

```
请求流程：
  OpenCode（小写） -> patchedFetch（PascalCase） -> AnyRouter API
                                                         |
  OpenCode <- transformResponse/SSE <--------------------+
```

## 许可证

MIT
