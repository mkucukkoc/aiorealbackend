import { Router } from 'express';
import { logger } from '../utils/logger';
import { attachRouteLogger } from '../utils/routeLogger';

// Derlenmiş ortamda bu dosya `dist/routes/chatBridge.js` altındadır ve
// gerçek router `dist/routes/chat.js` ile aynı klasördedir.
// Eğer chat.ts dosyası yoksa, boş bir router döndürür.
let createChatRouter: (() => Router) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chatModule = require('./chat');
  if (chatModule && chatModule.createChatRouter) {
    createChatRouter = chatModule.createChatRouter;
  } else if (chatModule && typeof chatModule.default === 'function') {
    createChatRouter = chatModule.default;
  }
} catch (error: any) {
  // chat.ts dosyası yoksa veya yüklenemezse, boş router döndür
  if (error.code === 'MODULE_NOT_FOUND') {
    logger.warn('chat.ts module not found, creating empty chat router');
  } else {
    logger.error({ err: error }, 'Failed to load chat module');
  }
}

// Eğer chat router yüklenemediyse, boş bir router döndür
if (!createChatRouter) {
  createChatRouter = () => {
    const router = Router();
    attachRouteLogger(router, 'chatBridge');
    logger.warn('Using empty chat router (chat.ts not found)');
    return router;
  };
} else {
  const originalFactory = createChatRouter;
  createChatRouter = () => {
    const router = originalFactory();
    attachRouteLogger(router, 'chatBridge');
    return router;
  };
}

export { createChatRouter };


