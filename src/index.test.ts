/**
 * mapName 函数回归测试
 *
 * 确保：
 * 1. OpenCode 内置工具名正确转换为 PascalCase
 * 2. MCP 工具名保持原样不被修改
 * 3. 边界情况安全处理
 */
import { describe, expect, it } from 'vitest';
import { NAME_MAP, mapName } from './index';

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
      'Augment-context-engine_codebase-retrieval',
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
