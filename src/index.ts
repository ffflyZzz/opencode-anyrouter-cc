/**
 * OpenCode Plugin: Anthropic Tool Name Transformer
 *
 * Converts Anthropic API tool names from lowercase to PascalCase in requests,
 * and fixes arrays serialized as strings in responses.
 *
 * Mechanism: monkey-patches globalThis.fetch at plugin load time,
 * intercepting only /v1/messages requests for transformation.
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

interface RequestBody {
  tools?: ToolDefinition[];
  messages?: Message[];
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
// Tool Name Mapping
// ============================================================

const NAME_MAP: ToolNameMap = {
  todowrite: 'TodoWrite',
  webfetch: 'WebFetch',
  google_search: 'Google_Search',
};

function mapName(name: string | undefined | null): string | undefined | null {
  if (!name || typeof name !== 'string') return name;
  if (NAME_MAP[name]) return NAME_MAP[name];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function isMessagesEndpoint(url: string): boolean {
  return typeof url === 'string' && url.includes('/v1/messages');
}

// ============================================================
// Request Transform
// ============================================================

function transformRequestBody(body: RequestBody): RequestBody {
  if (!body || typeof body !== 'object') return body;

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
    }),
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
  const _originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
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

    // --- Transform request body ---
    let actualInput: RequestInfo | URL = input;
    let actualInit: RequestInit | undefined = init;

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
        const newBody = JSON.stringify(transformed);

        if (input instanceof Request) {
          // Rebuild Request with new body
          const newHeaders = new Headers(input.headers);
          newHeaders.delete('content-length');
          actualInput = new Request(input, {
            body: newBody,
            headers: newHeaders,
          });
          actualInit = undefined;
        } else {
          // input is string/URL, body is in init
          actualInit = { ...init, body: newBody };
          if (actualInit.headers) {
            const h = new Headers(actualInit.headers as HeadersInit);
            h.delete('content-length');
            actualInit.headers = h;
          }
        }
      }
    } catch {
      // JSON parse failure: send as-is
    }

    // --- Send request ---
    const response = await _originalFetch(actualInput, actualInit);

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
}

// ============================================================
// Plugin Export
// ============================================================

export const AnthropicToolNameTransformerPlugin: Plugin = async () => {
  patchFetch();
  return {};
};

export default AnthropicToolNameTransformerPlugin;
