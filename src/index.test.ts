/**
 * 回归测试：mapName + AnyRouter 兼容性转换
 *
 * 确保：
 * 1. OpenCode 内置工具名正确转换为 PascalCase
 * 2. MCP 工具名保持原样不被修改
 * 3. 边界情况安全处理
 * 4. 请求体伪装为 Claude CLI 格式（billing、thinking、metadata、system 元素数）
 * 5. URL 追加 ?beta=true
 * 6. Headers 伪装为 Claude CLI
 */
import { describe, expect, it } from 'vitest';
import { NAME_MAP, mapName, transformRequestBody, transformUrl, transformHeaders } from './index';

// ============================================================
// 内置工具转换
// ============================================================

describe('mapName - 内置工具转换', () => {
  it('应转换 NAME_MAP 中的特殊映射', () => {
    expect(mapName('todowrite')).toBe('TodoWrite');
    expect(mapName('todoread')).toBe('TodoRead');
    expect(mapName('webfetch')).toBe('WebFetch');
    expect(mapName('google_search')).toBe('Google_Search');
    expect(mapName('apply_patch')).toBe('Apply_patch');
  });

  it('应转换单词内置工具为首字母大写', () => {
    expect(mapName('bash')).toBe('Bash');
    expect(mapName('read')).toBe('Read');
    expect(mapName('write')).toBe('Write');
    expect(mapName('edit')).toBe('Edit');
    expect(mapName('glob')).toBe('Glob');
    expect(mapName('grep')).toBe('Grep');
    expect(mapName('task')).toBe('Task');
    expect(mapName('plan')).toBe('Plan');
    expect(mapName('question')).toBe('Question');
    expect(mapName('skill')).toBe('Skill');
    expect(mapName('lsp')).toBe('Lsp');
    expect(mapName('ls')).toBe('Ls');
    expect(mapName('batch')).toBe('Batch');
    expect(mapName('codesearch')).toBe('Codesearch');
    expect(mapName('multiedit')).toBe('Multiedit');
    expect(mapName('websearch')).toBe('Websearch');
    expect(mapName('invalid')).toBe('Invalid');
  });
});

// ============================================================
// MCP 工具保持不变
// ============================================================

describe('mapName - MCP 工具保持不变', () => {
  it('不应修改含大写字母的 MCP 工具名', () => {
    expect(mapName('grep_app_searchGitHub')).toBe('grep_app_searchGitHub');
    expect(mapName('Github_create_or_update_file')).toBe('Github_create_or_update_file');
    expect(mapName('Chrome-devtools_click')).toBe('Chrome-devtools_click');
    expect(mapName('Websearch_web_search_exa')).toBe('Websearch_web_search_exa');
    expect(mapName('Augment-context-engine_codebase-retrieval')).toBe(
      'Augment-context-engine_codebase-retrieval'
    );
  });

  it('不应修改含连字符的全小写 MCP 工具名', () => {
    expect(mapName('context7_resolve-library-id')).toBe('context7_resolve-library-id');
  });

  it('不应修改模型返回的已转换形式的 MCP 工具名', () => {
    expect(mapName('Grep_app_searchGitHub')).toBe('Grep_app_searchGitHub');
  });
});

// ============================================================
// 边界情况
// ============================================================

describe('mapName - 边界情况', () => {
  it('应安全处理 null/undefined/空字符串', () => {
    expect(mapName(null)).toBe(null);
    expect(mapName(undefined)).toBe(undefined);
    expect(mapName('')).toBe('');
  });

  it('不应修改未知工具名', () => {
    expect(mapName('some_unknown_tool')).toBe('some_unknown_tool');
    expect(mapName('newFeature')).toBe('newFeature');
  });
});

// ============================================================
// 白名单完整性检查
// ============================================================

describe('NAME_MAP 白名单完整性', () => {
  // 基于 https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/tool
  const EXPECTED_BUILT_IN_TOOLS = [
    'apply_patch',
    'bash',
    'batch',
    'codesearch',
    'edit',
    'glob',
    'google_search',
    'grep',
    'invalid',
    'ls',
    'lsp',
    'multiedit',
    'plan',
    'question',
    'read',
    'skill',
    'task',
    'todoread',
    'todowrite',
    'webfetch',
    'websearch',
    'write',
  ];

  it('应包含所有已知的 OpenCode 内置工具', () => {
    for (const tool of EXPECTED_BUILT_IN_TOOLS) {
      expect(NAME_MAP).toHaveProperty(tool);
    }
  });

  it('NAME_MAP 中的所有值应以大写字母开头', () => {
    for (const [key, value] of Object.entries(NAME_MAP)) {
      expect(value[0]).toBe(value[0].toUpperCase());
    }
  });
});

// ============================================================
// URL 转换
// ============================================================

describe('transformUrl', () => {
  it('应在无 query 的 URL 追加 ?beta=true', () => {
    expect(transformUrl('https://anyrouter.top/v1/messages')).toBe(
      'https://anyrouter.top/v1/messages?beta=true'
    );
  });

  it('应在已有 query 的 URL 追加 &beta=true', () => {
    expect(transformUrl('https://anyrouter.top/v1/messages?foo=bar')).toBe(
      'https://anyrouter.top/v1/messages?foo=bar&beta=true'
    );
  });

  it('不应重复追加 beta=true', () => {
    expect(transformUrl('https://anyrouter.top/v1/messages?beta=true')).toBe(
      'https://anyrouter.top/v1/messages?beta=true'
    );
  });

  it('不应重复追加 beta=true（已在 query 中间）', () => {
    expect(transformUrl('https://anyrouter.top/v1/messages?beta=true&foo=bar')).toBe(
      'https://anyrouter.top/v1/messages?beta=true&foo=bar'
    );
  });
});

// ============================================================
// Headers 转换
// ============================================================

describe('transformHeaders', () => {
  it('应设置 Claude CLI User-Agent', () => {
    const headers = new Headers({ 'User-Agent': 'ai-sdk/anthropic/2.0.65' });
    const transformed = transformHeaders(headers);
    expect(transformed.get('User-Agent')).toMatch(/^claude-cli\//);
  });

  it('应设置 Accept 为 application/json', () => {
    const headers = new Headers({ Accept: '*/*' });
    const transformed = transformHeaders(headers);
    expect(transformed.get('Accept')).toBe('application/json');
  });

  it('应添加 anthropic-beta header', () => {
    const transformed = transformHeaders(new Headers());
    expect(transformed.get('anthropic-beta')).toContain('claude-code-20250219');
  });

  it('应添加 anthropic-dangerous-direct-browser-access', () => {
    const transformed = transformHeaders(new Headers());
    expect(transformed.get('anthropic-dangerous-direct-browser-access')).toBe('true');
  });

  it('应添加 x-app: cli', () => {
    const transformed = transformHeaders(new Headers());
    expect(transformed.get('x-app')).toBe('cli');
  });

  it('应移除 x-api-key', () => {
    const headers = new Headers({ 'x-api-key': 'sk-test123' });
    const transformed = transformHeaders(headers);
    expect(transformed.get('x-api-key')).toBeNull();
  });

  it('应保留 Authorization header', () => {
    const headers = new Headers({ Authorization: 'Bearer sk-test123' });
    const transformed = transformHeaders(headers);
    expect(transformed.get('Authorization')).toBe('Bearer sk-test123');
  });

  it('应移除 content-length', () => {
    const headers = new Headers({ 'content-length': '1234' });
    const transformed = transformHeaders(headers);
    expect(transformed.get('content-length')).toBeNull();
  });
});

// ============================================================
// 请求体转换 - AnyRouter 兼容性
// ============================================================

describe('transformRequestBody - AnyRouter 兼容性', () => {
  it('应注入 billing header 到 system[0]', () => {
    const body = {
      system: [
        { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Be concise.', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system![0].text).toContain('x-anthropic-billing-header');
    expect(result.system![0].cache_control).toBeUndefined();
  });

  it('system 应恰好 3 个元素', () => {
    const body = {
      system: [
        { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Be concise.', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
  });

  it('应在不足 3 个元素时补充占位元素', () => {
    const body = {
      system: [{ type: 'text', text: 'Short.' }],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
    expect(result.system![0].text).toContain('x-anthropic-billing-header');
  });

  it('应在超过 3 个元素时裁剪', () => {
    const body = {
      system: [
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
        { type: 'text', text: 'C' },
        { type: 'text', text: 'D' },
        { type: 'text', text: 'E' },
      ],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
    expect(result.system![0].text).toContain('x-anthropic-billing-header');
  });

  it('无 system 时应创建 3 元素数组', () => {
    const body = { messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
    expect(result.system![0].text).toContain('x-anthropic-billing-header');
  });

  it('不应重复注入 billing header（幂等性）', () => {
    const body = {
      system: [
        { type: 'text', text: 'x-anthropic-billing-header: something' },
        { type: 'text', text: 'A', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'B', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
    const billingCount = result.system!.filter((s) =>
      s.text?.includes('x-anthropic-billing-header')
    ).length;
    expect(billingCount).toBe(1);
  });

  it('应将 thinking 改为 adaptive', () => {
    const body = {
      thinking: { type: 'enabled', budget_tokens: 16000 },
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.thinking).toEqual({ type: 'adaptive' });
  });

  it('应设置 max_tokens 为 64000', () => {
    const body = { max_tokens: 48000, messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.max_tokens).toBe(64000);
  });

  it('应在缺失 metadata 时添加正确格式的 user_id', () => {
    const body = { messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.metadata).toBeDefined();
    const userId = result.metadata!.user_id as string;
    // 格式：user_<64位hex>_account__session_<UUID>
    expect(userId).toMatch(/^user_[0-9a-f]{64}_account__session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('不应覆盖已有的 metadata', () => {
    const body = { metadata: { user_id: 'existing_user' }, messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.metadata!.user_id).toBe('existing_user');
  });

  // Oracle 审核补充测试：边界情况

  it('应在 billing 不在 [0] 时正确重排到 [0]', () => {
    const body = {
      system: [
        { type: 'text', text: 'A', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'x-anthropic-billing-header: old', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'B', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
    expect(result.system![0].text).toContain('x-anthropic-billing-header');
    // billing 应该是新生成的，不是原来的 'old'
    expect(result.system![0].text).toContain('cc_version');
  });

  it('metadata 为空对象时应补充 user_id', () => {
    const body = { metadata: {}, messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.metadata!.user_id).toBeDefined();
    expect(result.metadata!.user_id as string).toMatch(/^user_[0-9a-f]{64}/);
  });

  it('metadata 有其他字段但无 user_id 时应补充', () => {
    const body = { metadata: { trace_id: 'abc' }, messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.metadata!.trace_id).toBe('abc');
    expect(result.metadata!.user_id).toBeDefined();
  });

  it('无 thinking 时应补充 adaptive', () => {
    const body = { messages: [{ content: [] }] };
    const result = transformRequestBody(body);
    expect(result.thinking).toEqual({ type: 'adaptive' });
  });

  it('超过 3 个 system 元素时应保留最后两个 content blocks', () => {
    const body = {
      system: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
        { type: 'text', text: 'Third' },
        { type: 'text', text: 'Important-A', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Important-B', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ content: [] }],
    };
    const result = transformRequestBody(body);
    expect(result.system!.length).toBe(3);
    expect(result.system![0].text).toContain('x-anthropic-billing-header');
    expect(result.system![1].text).toBe('Important-A');
    expect(result.system![2].text).toBe('Important-B');
  });
    });
