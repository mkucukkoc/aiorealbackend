import { Router, Request, Response } from 'express';
import { logger } from './logger';
import { logRequestJson, logResponseJson } from './jsonLogging';

type LogData = Record<string, unknown>;

export function attachRouteLogger(router: Router, routeName: string) {
  router.use((req, res, next) => {
    const startTime = Date.now();
    const requestLog = buildRequestLog(req);
    logRouteStep(routeName, 'request_received', requestLog);
    logRequestJson(routeName, {
      method: req.method,
      path: req.originalUrl,
      body: req.body ?? {},
      query: req.query ?? {},
      params: req.params ?? {},
    });

    const originalJson = res.json.bind(res);
    res.json = ((body: any) => {
      logResponseJson(routeName, body);
      return originalJson(body);
    }) as Response['json'];

    const logResponse = (event: 'response_sent' | 'response_aborted') => {
      const responseLog = {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startTime,
        contentLength: res.get('Content-Length'),
        finished: !res.writableFinished ? false : true,
      };
      logRouteStep(routeName, event, { ...responseLog, requestId: requestLog.requestId });
    };

    res.on('finish', () => logResponse('response_sent'));
    res.on('close', () => {
      if (!res.writableEnded) {
        logResponse('response_aborted');
      }
    });

    next();
  });
}

export function logRouteStep(routeName: string, step: string, data: LogData = {}) {
  logger.info({ route: routeName, step, ...data }, '[RouteLogger]');
}

function buildRequestLog(req: Request): LogData {
  const bodyKeys =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? Object.keys(req.body)
      : undefined;

  return {
    method: req.method,
    path: req.originalUrl,
    ip: (req as any).ip || (req as any).connection?.remoteAddress,
    hasBody: Boolean(bodyKeys && bodyKeys.length > 0),
    bodyKeys,
    params: req.params,
    query: req.query,
    headers: {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
      'x-request-id': req.headers['x-request-id'],
    },
    requestId: req.headers['x-request-id'] || undefined,
    userId: extractUserId(req),
  };
}

function extractUserId(req: Request): string | null {
  const userCandidate = (req as any).user;
  if (!userCandidate) {
    return null;
  }
  if (typeof userCandidate === 'string') {
    return userCandidate;
  }
  if (typeof userCandidate === 'object') {
    if (typeof userCandidate.id === 'string' || typeof userCandidate.id === 'number') {
      return String(userCandidate.id);
    }
    if (typeof userCandidate.uid === 'string') {
      return userCandidate.uid;
    }
  }
  return null;
}

