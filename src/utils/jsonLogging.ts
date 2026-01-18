import { logger } from './logger';

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 4;

function safeForLog(value: any, depth = 0): any {
  if (depth > MAX_DEPTH) return '[max-depth-reached]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer length=${value.length}>`;
  }

  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_LENGTH).map((v) => safeForLog(v, depth + 1));
    return value.length > MAX_ARRAY_LENGTH ? [...sliced, '[truncated-array]'] : sliced;
  }

  const output: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    output[k] = safeForLog(v, depth + 1);
  }
  return output;
}

export function jsonPretty(value: any): string {
  try {
    return JSON.stringify(safeForLog(value), null, 2);
  } catch (err) {
    return `<unserializable:${(err as Error)?.message || 'error'}>`;
  }
}

export function logRequestJson(routeName: string, payload: any): void {
  const safePayload = safeForLog(payload);
  const method = (safePayload as any)?.method;
  const path = (safePayload as any)?.path;
  const endpointLabel = method && path ? `${method} ${path}` : routeName;
  logger.info(
    { route: routeName, endpoint: endpointLabel, payload: safePayload },
    `[${routeName}] request JSON (${endpointLabel})`
  );
}

export function logResponseJson(routeName: string, payload: any): void {
  const safePayload = safeForLog(payload);
  const endpointLabel = (safePayload as any)?.endpoint || routeName;
  logger.info(
    { route: routeName, endpoint: endpointLabel, response: safePayload },
    `[${routeName}] response JSON (${endpointLabel})`
  );
}


