/**
 * OpenCode Plugin: Anthropic Tool Name Transformer + AnyRouter Compatibility
 *
 * 功能：
 * 1. 将 OpenCode 小写工具名转为 PascalCase（白名单策略）
 * 2. 修复 AnyRouter 返回的数组序列化问题
 * 3. 伪装请求为 Claude CLI 格式（headers + body），绕过 AnyRouter 校验
 *
 * 机制：monkey-patch globalThis.fetch，仅拦截 /v1/messages 请求
 */

import type { Plugin } from '@opencode-ai/plugin';

// ============================================================
// Types
// ============================================================

type ToolNameMap = Record<string, string>;

interface ToolDefinition {
  name?: string;
  [key: string]: unknown;
}

interface ContentBlock {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Message {
  content?: ContentBlock[];
  [key: string]: unknown;
}

interface SystemBlock {
  type?: string;
  text?: string;
  cache_control?: { type: string };
  [key: string]: unknown;
}

interface RequestBody {
  tools?: ToolDefinition[];
  messages?: Message[];
  system?: SystemBlock[];
  thinking?: { type: string; budget_tokens?: number };
  max_tokens?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ResponseBody {
  content?: ContentBlock[];
  [key: string]: unknown;
}

interface SSEContentBlock {
  type?: string;
  name?: string;
  [key: string]: unknown;
}

interface SSEData {
  type?: string;
  content_block?: SSEContentBlock;
  [key: string]: unknown;
}

// ============================================================
// Constants: AnyRouter 兼容性配置
// ============================================================

// Claude CLI 伪装版本号
const CLI_VERSION = '2.1.77';
const CLI_BUILD = '7b9';
const CLI_ENTRYPOINT = 'sdk-cli';
const CLI_CCH = '8ffaf';

// AnyRouter 校验必需的 headers
const REQUIRED_HEADERS: Record<string, string> = {
  'User-Agent': `claude-cli/${CLI_VERSION} (external, ${CLI_ENTRYPOINT})`,
  Accept: 'application/json',
  'anthropic-beta':
    'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,' +
    'context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24',
  'anthropic-dangerous-direct-browser-access': 'true',
  'x-app': 'cli',
};

// billing header 内容（必须作为 system[0]）
const BILLING_TEXT =
  `x-anthropic-billing-header: cc_version=${CLI_VERSION}.${CLI_BUILD}; ` +
  `cc_entrypoint=${CLI_ENTRYPOINT}; cch=${CLI_CCH};`;

// 生成符合 AnyRouter 校验的 user_id
// 格式：user_<64位hex>_account__session_<UUID>
function generateUserId(): string {
  const randomHex = (len: number) => {
    const bytes = new Uint8Array(Math.ceil(len / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, len);
  };
  const hex64 = randomHex(64);
  const uuid = `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
  return `user_${hex64}_account__session_${uuid}`;
}

// ============================================================
// Tool Name Mapping
// ============================================================

// OpenCode 内置工具名白名单（全小写 → 正确大小写）
// 参考：https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/tool
const NAME_MAP: ToolNameMap = {
  // 需要特殊大小写的内置工具
  todowrite: 'TodoWrite',
  todoread: 'TodoRead',
  webfetch: 'WebFetch',
  google_search: 'Google_Search',
  apply_patch: 'Apply_patch',
  // 单词内置工具（首字母大写）
  bash: 'Bash',
  batch: 'Batch',
  codesearch: 'Codesearch',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  invalid: 'Invalid',
  ls: 'Ls',
  lsp: 'Lsp',
  multiedit: 'Multiedit',
  plan: 'Plan',
  question: 'Question',
  read: 'Read',
  skill: 'Skill',
  task: 'Task',
  websearch: 'Websearch',
  write: 'Write',
};

function mapName(name: string | undefined | null): string | undefined | null {
  if (!name || typeof name !== 'string') return name;
  if (NAME_MAP[name]) return NAME_MAP[name];
  // 不在白名单中的工具名保持原样（MCP 工具等），不做任何大小写转换。
  // MCP 工具名已包含正确大小写（如 grep_app_searchGitHub、context7_resolve-library-id），
  // 盲目转换会导致工具调用失败。
  return name;
}

function isMessagesEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    // 精确匹配 pathname: /v1/messages（不匹配 /v1/messages-old 等）
    return parsed.pathname === '/v1/messages' || parsed.pathname.endsWith('/v1/messages');
  } catch {
    // URL 无法解析时退回字符串匹配（兼容相对路径等极端情况）
    return typeof url === 'string' && /\/v1\/messages(?:\?|$)/.test(url);
  }
}

// ============================================================
// URL Transform: 追加 ?beta=true
// ============================================================

function transformUrl(url: string): string {
  // 使用 URL API 安全地处理 query 参数
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('beta')) {
      parsed.searchParams.set('beta', 'true');
    }
    return parsed.toString();
  } catch {
    // 退回字符串拼接（兼容无法解析的 URL）
    if (url.includes('?')) {
      if (!url.includes('beta=true')) return `${url}&beta=true`;
      return url;
    }
    return `${url}?beta=true`;
  }
}

// ============================================================
// Headers Transform: 伪装为 Claude CLI
// ============================================================

function transformHeaders(headers: Headers): Headers {
  const next = new Headers(headers);

  // 移除 OpenCode 特有的 x-api-key（AnyRouter 拒绝此 header）
  next.delete('x-api-key');

  // 覆盖/添加 AnyRouter 必需的 headers
  for (const [key, value] of Object.entries(REQUIRED_HEADERS)) {
    next.set(key, value);
  }

  // 移除 content-length（body 已被修改，由 runtime 重新计算）
  next.delete('content-length');

  return next;
}

// ============================================================
// Request Body Transform
// ============================================================


/**
 * system 数组规范化：确保 billing header 在 [0]，总共恰好 3 个元素。
 *
 * 策略：
 * 1. 从原数组中剥离已有的 billing block（如果存在）
 * 2. 构造新数组：[billing, ...content_blocks]
 * 3. 保留原始 content blocks 的最后 2 个（通常是 system prompt 核心内容）
 * 4. 不足时用占位元素补齐
 */
function normalizeSystemBlocks(system: SystemBlock[]): SystemBlock[] {
  const billing: SystemBlock = { type: 'text', text: BILLING_TEXT };
  const placeholder: SystemBlock = { type: 'text', text: '.', cache_control: { type: 'ephemeral' } };

  // 剥离已有的 billing block
  const contentBlocks = system.filter(
    (block) => !(typeof block.text === 'string' && block.text.includes('x-anthropic-billing-header'))
  );

  // 保留最后 2 个 content blocks（如果有）
  const kept =
    contentBlocks.length <= 2 ? contentBlocks : contentBlocks.slice(contentBlocks.length - 2);

  // 组装：[billing, block1, block2]，不足时补占位元素
  const result: SystemBlock[] = [billing, ...kept];
  while (result.length < 3) {
    result.push({ ...placeholder });
  }
  return result;
}

function transformRequestBody(body: RequestBody): RequestBody {
  if (!body || typeof body !== 'object') return body;

  // --- 工具名转换 ---
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool) => {
      if (tool?.name) tool.name = mapName(tool.name) ?? tool.name;
    });
  }

  if (Array.isArray(body.messages)) {
    body.messages.forEach((message) => {
      if (!Array.isArray(message?.content)) return;
      message.content.forEach((block) => {
        if (block?.type === 'tool_use' && block.name) {
          block.name = mapName(block.name) ?? block.name;
        }
      });
    });
  }

  // --- system 数组规范化：确保 billing 在 [0]，恰好 3 个元素 ---
  body.system = normalizeSystemBlocks(Array.isArray(body.system) ? body.system : []);

  // --- thinking：强制设为 adaptive（AnyRouter 不接受 enabled+budget_tokens，也要求存在） ---
  body.thinking = { type: 'adaptive' };

  // --- max_tokens：AnyRouter 需要 64000 ---
  body.max_tokens = 64000;

  // --- metadata：AnyRouter 必需，确保 user_id 存在且格式正确 ---
  if (!body.metadata || typeof body.metadata !== 'object') {
    body.metadata = { user_id: generateUserId() };
  } else if (!body.metadata.user_id) {
    body.metadata.user_id = generateUserId();
  }

  return body;
}

// ============================================================
// Response Transform: Fix arrays serialized as strings
// ============================================================

function transformResponseBody(body: ResponseBody): ResponseBody {
  if (!body || !Array.isArray(body.content)) return body;

  body.content.forEach((block) => {
    if (block?.type !== 'tool_use' || !block.input || typeof block.input !== 'object') return;

    for (const key of Object.keys(block.input)) {
      const value = block.input[key];
      if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
        try {
          block.input[key] = JSON.parse(value);
        } catch {
          // ignore parse errors
        }
      }
    }
  });

  return body;
}

// ============================================================
// SSE Stream Transform
// ============================================================

function transformSSELine(line: string): string {
  if (!line.startsWith('data:')) return line;

  const jsonStr = line.slice(5).trim();
  if (!jsonStr || jsonStr === '[DONE]') return line;

  try {
    const data: SSEData = JSON.parse(jsonStr);

    if (
      data.type === 'content_block_start' &&
      data.content_block?.type === 'tool_use' &&
      data.content_block.name
    ) {
      data.content_block.name = mapName(data.content_block.name) ?? data.content_block.name;
      return `data: ${JSON.stringify(data)}`;
    }

    return line;
  } catch {
    return line;
  }
}

function transformSSEBody(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const transformed = part.split('\n').map(transformSSELine).join('\n');
          controller.enqueue(encoder.encode(`${transformed}\n\n`));
        }
      },
      flush(controller: TransformStreamDefaultController<Uint8Array>) {
        buffer += decoder.decode();
        if (!buffer.trim()) return;
        const transformed = buffer.split('\n').map(transformSSELine).join('\n');
        controller.enqueue(encoder.encode(`${transformed}\n\n`));
      },
    })
  );
}

function cloneResponseHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  next.delete('content-length');
  return next;
}

// ============================================================
// Monkey-patch globalThis.fetch
// ============================================================

function patchFetch(): void {
  // 幂等保护：避免重复加载时多层包裹
  if ((globalThis.fetch as unknown as Record<string, boolean>).__anyrouter_patched) return;
  const _originalFetch = globalThis.fetch;
  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Extract URL
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : '';

    const messagesRequest = isMessagesEndpoint(url);

    // Non-messages endpoint: pass through
    if (!messagesRequest) {
      return _originalFetch(input, init);
    }

    // --- Transform URL: 追加 ?beta=true ---
    const transformedUrl = transformUrl(url);

    // --- Transform request body ---
    let actualInit: RequestInit = { ...(init || {}) };
    let requestHeaders: Headers;

    try {
      let bodyText = '';
      if (init?.body && typeof init.body === 'string') {
        bodyText = init.body;
      } else if (init?.body instanceof ArrayBuffer || init?.body instanceof Uint8Array) {
        bodyText = new TextDecoder().decode(init.body);
      } else if (input instanceof Request && input.body) {
        bodyText = await input.clone().text();
      }

      if (bodyText) {
        const parsed: RequestBody = JSON.parse(bodyText);
        const transformed = transformRequestBody(parsed);
        actualInit.body = JSON.stringify(transformed);
      }
    } catch {
      // JSON parse failure: send body as-is
    }

    // --- Transform headers: 伪装为 Claude CLI ---
    if (input instanceof Request) {
      requestHeaders = transformHeaders(new Headers(input.headers));
    } else if (init?.headers) {
      requestHeaders = transformHeaders(new Headers(init.headers as HeadersInit));
    } else {
      requestHeaders = transformHeaders(new Headers());
    }
    actualInit.headers = requestHeaders;

    // --- Send request with transformed URL ---
    const response = await _originalFetch(transformedUrl, actualInit);

    // --- Transform response ---
    const contentType = response.headers.get('content-type') || '';

    // SSE streaming
    if (contentType.includes('text/event-stream') && response.body) {
      return new Response(transformSSEBody(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: cloneResponseHeaders(response.headers),
      });
    }

    // JSON (non-streaming)
    if (contentType.includes('application/json')) {
      const text = await response.text();
      let output = text;

      if (text) {
        try {
          output = JSON.stringify(transformResponseBody(JSON.parse(text)));
        } catch {
          output = text;
        }
      }

      return new Response(output, {
        status: response.status,
        statusText: response.statusText,
        headers: cloneResponseHeaders(response.headers),
      });
    }

    return response;
  };
  (globalThis.fetch as unknown as Record<string, boolean>).__anyrouter_patched = true;
}

// ============================================================
// Monkey-patch at import time (same as .mjs approach)
// ============================================================

patchFetch();

// ============================================================
// Plugin Export
// ============================================================

export const AnthropicToolNameTransformerPlugin: Plugin = async () => {
  return {};
};

export default AnthropicToolNameTransformerPlugin;

// ============================================================
// 测试导出（仅供单元测试使用）
// ============================================================

export { NAME_MAP, mapName, transformRequestBody, transformUrl, transformHeaders };
