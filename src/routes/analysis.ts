import { Router } from 'express';
import axios from 'axios';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { authRateLimits } from '../middleware/rateLimitMiddleware';
import { db, storage } from '../firebase';
import { logger } from '../utils/logger';
import { ResponseBuilder } from '../types/response';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isAI: { type: 'BOOLEAN', description: 'Whether the image is AI generated' },
    confidenceScore: { type: 'NUMBER', description: 'Confidence score between 0 and 100' },
    detectedModel: { type: 'STRING', description: "The likely model or 'Camera' if real" },
    verdict: { type: 'STRING', description: 'A short forensic verdict summary' },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          type: { type: 'STRING' },
          status: { type: 'STRING', enum: ['alert', 'secure'] },
        },
        required: ['title', 'description', 'type', 'status'],
      },
    },
    probabilityBreakdown: {
      type: 'OBJECT',
      properties: {
        gan: { type: 'NUMBER' },
        diffusion: { type: 'NUMBER' },
        organic: { type: 'NUMBER' },
      },
      required: ['gan', 'diffusion', 'organic'],
    },
    technicalSpecs: {
      type: 'OBJECT',
      properties: {
        dimensions: { type: 'STRING' },
        colorSpace: { type: 'STRING' },
        modelId: { type: 'STRING' },
        entropy: { type: 'STRING' },
      },
      required: ['dimensions', 'colorSpace', 'modelId', 'entropy'],
    },
  },
  required: [
    'isAI',
    'confidenceScore',
    'detectedModel',
    'verdict',
    'findings',
    'probabilityBreakdown',
    'technicalSpecs',
  ],
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const extractImageData = async (params: {
  imageBase64?: string;
  imageUrl?: string;
}) => {
  if (params.imageBase64) {
    let mimeType = 'image/jpeg';
    let stripped = params.imageBase64;
    if (params.imageBase64.startsWith('data:')) {
      const [meta, data] = params.imageBase64.split(',');
      const match = meta?.match(/^data:(.+);base64$/i);
      mimeType = match?.[1] || 'image/jpeg';
      stripped = data || '';
    }
    if (!stripped) {
      throw new Error('imageBase64 is empty');
    }
    return {
      mimeType,
      data: stripped,
    };
  }

  if (params.imageUrl) {
    const response = await axios.get<ArrayBuffer>(params.imageUrl, {
      responseType: 'arraybuffer',
    });
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const base64 = Buffer.from(response.data).toString('base64');
    return { mimeType, data: base64 };
  }

  throw new Error('imageBase64 or imageUrl is required');
};

const getImageExtension = (mimeType: string) => {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    default:
      return 'bin';
  }
};

const uploadImageToStorage = async (params: {
  requestId?: string;
  userId: string;
  analysisId: string;
  inlineData: { mimeType: string; data: string };
}) => {
  const { requestId, userId, analysisId, inlineData } = params;
  const bucket = storage.bucket();
  const extension = getImageExtension(inlineData.mimeType);
  const filePath = `forensic/${userId}/${analysisId}.${extension}`;
  const file = bucket.file(filePath) as any;

  if (typeof file.save !== 'function') {
    logger.warn({ requestId, userId, filePath }, 'Storage file.save is unavailable');
    return null;
  }

  const buffer = Buffer.from(inlineData.data, 'base64');
  await file.save(buffer, {
    contentType: inlineData.mimeType,
    resumable: false,
    metadata: { contentType: inlineData.mimeType },
  });

  try {
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '01-01-2100',
    });
    return { url: signedUrl, path: filePath };
  } catch (error) {
    logger.warn({ requestId, userId, filePath, err: error }, 'Failed to get signed URL');
    const bucketName = typeof (bucket as any).name === 'string'
      ? (bucket as any).name
      : process.env.FIREBASE_STORAGE_BUCKET;
    return bucketName ? { url: `https://storage.googleapis.com/${bucketName}/${filePath}`, path: filePath } : null;
  }
};

const normalizeStoragePath = (value?: string | null) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('gs://')) {
    const parts = trimmed.replace('gs://', '').split('/');
    parts.shift();
    return parts.join('/');
  }

  if (trimmed.includes('?')) {
    const [beforeQuery] = trimmed.split('?');
    if (beforeQuery) {
      return normalizeStoragePath(beforeQuery);
    }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname.endsWith('storage.googleapis.com')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts.length > 1 ? parts.slice(1).join('/') : null;
      }
      const match = parsed.pathname.match(/\/o\/(.+)$/);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
      return parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
    } catch {
      return null;
    }
  }

  return trimmed;
};

const resolveStoragePath = (data: { storagePath?: string; imageUrl?: string } | null | undefined) => {
  if (!data) return null;
  return normalizeStoragePath(data.storagePath) || normalizeStoragePath(data.imageUrl);
};

export function createAnalysisRouter(): Router {
  const r = Router();

  r.post('/forensic', authenticateToken, async (req, res) => {
    const requestIdHeader = req.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const userId = (req as AuthRequest).user?.id;
    const { imageBase64, imageUrl, title, lastMessage, language } = req.body || {};

    if (!GEMINI_API_KEY) {
      logger.error({ requestId }, 'GEMINI_API_KEY is missing');
      return res.status(500).json(
        ResponseBuilder.error('config_error', 'Gemini API key is not configured')
      );
    }

    if (!userId) {
      return res.status(401).json(
        ResponseBuilder.error('access_denied', 'Authentication required')
      );
    }

    try {
      logger.info(
        {
          requestId,
          userId,
          hasBase64: Boolean(imageBase64),
          hasUrl: Boolean(imageUrl),
        },
        'Forensic analysis request received'
      );

      const inlineData = await extractImageData({ imageBase64, imageUrl });
      const analysisRef = db.collection('users').doc(userId).collection('analyze1').doc();
      const normalizedLanguage = typeof language === 'string' ? language.toLowerCase().trim() : 'en';
      const responseLanguage = normalizedLanguage === 'tr' ? 'tr' : 'en';

      const geminiPayload = {
        contents: [
          {
            parts: [
              {
                text:
                  responseLanguage === 'tr'
                    ? 'Dünya çapında bir adli görüntü analiz uzmanı gibi davran. Verilen görseli yapay zeka üretim izleri (GAN desenleri, diffusion gürültüsü, yapay ışık, piksel düzeyinde entropi sapmaları, metadata anomalileri) açısından analiz et. Yanıtı JSON formatında, ayrıntılı teknik bir adli rapor olarak TÜRKÇE döndür.'
                    : 'Act as a world-class forensic image analyst. Analyze the provided image for AI generation artifacts (GAN patterns, diffusion noise, unnatural lighting, pixel-level entropy deviations, metadata anomalies). Provide a detailed technical forensic report in JSON format in ENGLISH.',
              },
              { inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_SCHEMA,
        },
      };

      logger.info(
        { requestId, userId, imageBytes: inlineData.data.length },
        'Gemini request prepared'
      );

      const geminiResponse = await axios.post<GeminiResponse>(
        `${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`,
        geminiPayload,
        { headers: { 'Content-Type': 'application/json' } }
      );

      const geminiText =
        geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsedResult = JSON.parse(geminiText);

      logger.info(
        { requestId, userId, hasResult: Boolean(parsedResult) },
        'Gemini analysis completed'
      );

      const storedImage = await uploadImageToStorage({
        requestId,
        userId,
        analysisId: analysisRef.id,
        inlineData,
      });

      const now = new Date();
      const analysisDoc = {
        analysisId: analysisRef.id,
        userId,
        imageUrl: storedImage?.url || null,
        storagePath: storedImage?.path || null,
        sourceImageUrl: typeof imageUrl === 'string' ? imageUrl : null,
        language: responseLanguage,
        result: parsedResult,
        createdAt: now,
        updatedAt: now,
        timestamp: now,
        deleted: false,
        deletedAt: null,
        favorites: false,
        hasChatTitle: Boolean(title),
        lastMessage: typeof lastMessage === 'string' ? lastMessage : '',
        title: typeof title === 'string' ? title : '',
      };

      await analysisRef.set(analysisDoc);

      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      const currentCount = (userSnap.data() as any)?.analyze1 || 0;
      await userRef.set({ analyze1: currentCount + 1 }, { merge: true });

      return res.json(
        ResponseBuilder.success(
          { analysisId: analysisRef.id, result: parsedResult },
          'Analysis completed'
        )
      );
    } catch (error: any) {
      logger.error(
        { requestId, userId, error: error?.message ?? error },
        'Forensic analysis failed'
      );
      return res.status(500).json(
        ResponseBuilder.error('analysis_failed', 'Failed to analyze image')
      );
    }
  });

  r.get('/history', authenticateToken, async (req, res) => {
    const requestIdHeader = req.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    const userId = (req as AuthRequest).user?.id;
    const limit = Math.min(Number(req.query.limit || 50), 100);

    if (!userId) {
      return res.status(401).json(
        ResponseBuilder.error('access_denied', 'Authentication required')
      );
    }

    try {
      const snapshot = await db
        .collection('users')
        .doc(userId)
        .collection('analyze1')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const items = snapshot.docs.map((doc: QueryDocumentSnapshot) => doc.data());

      logger.info(
        { requestId, userId, count: items.length },
        'Analysis history fetched'
      );

      return res.json(ResponseBuilder.success(items, 'History loaded'));
    } catch (error: any) {
      logger.error(
        { requestId, userId, error: error?.message ?? error },
        'Failed to fetch analysis history'
      );
      return res
        .status(500)
        .json(ResponseBuilder.error('history_failed', 'Failed to load history'));
    }
  });

  r.delete(
    '/history/:id',
    authRateLimits.general,
    authenticateToken,
    async (req, res) => {
      const userId = (req as AuthRequest).user?.id;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json(
          ResponseBuilder.error('unauthorized', 'Authentication required')
        );
      }
      if (!id) {
        return res.status(400).json(
          ResponseBuilder.error('invalid_request', 'History id is required')
        );
      }

      try {
        const docRef = db.collection('users').doc(userId).collection('analyze1').doc(id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          return res.status(404).json(
            ResponseBuilder.error('NOT_FOUND', 'History item not found')
          );
        }
        const data = docSnap.data() as { userId?: string; storagePath?: string; imageUrl?: string } | undefined;
        if (data?.userId && data.userId !== userId) {
          return res.status(404).json(
            ResponseBuilder.error('NOT_FOUND', 'History item not found')
          );
        }

        const storagePath = resolveStoragePath(data);
        if (storagePath) {
          const candidatePaths = new Set<string>();
          candidatePaths.add(storagePath);
          if (/\.[^/.]+$/.test(storagePath)) {
            candidatePaths.add(storagePath.replace(/\.[^/.]+$/, ''));
          } else {
            ['jpg', 'jpeg', 'png', 'webp'].forEach((ext) => {
              candidatePaths.add(`${storagePath}.${ext}`);
            });
          }

          let deleted = false;
          for (const path of candidatePaths) {
            try {
              await storage.bucket().file(path).delete();
              deleted = true;
              break;
            } catch (error: any) {
              const code = error?.code;
              const reason = error?.errors?.[0]?.reason;
              if (code === 404 || reason === 'notFound') {
                continue;
              }
              logger.warn({ err: error, storagePath: path, userId }, 'Failed to delete analysis storage object');
              break;
            }
          }
          if (!deleted) {
            logger.warn({ storagePath, userId }, 'Analysis storage object not found');
          }
        }

        await docRef.delete();

        return res.json(ResponseBuilder.success({ id, deleted: true }));
      } catch (error) {
        logger.error({ err: error, historyId: id }, 'Failed to delete history item');
        return res
          .status(500)
          .json(ResponseBuilder.error('DELETE_FAILED', 'History item could not be deleted'));
      }
    }
  );

  return r;
}
