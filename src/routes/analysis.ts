import { Router } from 'express';
import axios from 'axios';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';
import { db } from '../firebase';
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

const extractImageData = async (params: {
  imageBase64?: string;
  imageUrl?: string;
}) => {
  if (params.imageBase64) {
    const stripped = params.imageBase64.startsWith('data:')
      ? params.imageBase64.split(',')[1] || ''
      : params.imageBase64;
    return {
      mimeType: 'image/jpeg',
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

export function createAnalysisRouter(): Router {
  const r = Router();

  r.post('/forensic', authenticateToken, async (req, res) => {
    const requestId = req.headers['x-request-id'] || undefined;
    const userId = (req as AuthRequest).user?.id;
    const { imageBase64, imageUrl, title, lastMessage } = req.body || {};

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

      const geminiPayload = {
        contents: [
          {
            parts: [
              {
                text:
                  'Act as a world-class forensic image analyst. Analyze the provided image for AI generation artifacts (GAN patterns, diffusion noise, unnatural lighting, pixel-level entropy deviations, metadata anomalies). Provide a detailed technical forensic report in JSON format.',
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

      const geminiResponse = await axios.post(
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

      const now = new Date();
      const analysisRef = db.collection('users').doc(userId).collection('analyze1').doc();
      const analysisDoc = {
        analysisId: analysisRef.id,
        userId,
        imageUrl: imageUrl || (imageBase64 ? `data:image/jpeg;base64,${inlineData.data}` : null),
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
    const requestId = req.headers['x-request-id'] || undefined;
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

      const items = snapshot.docs.map((doc) => doc.data());

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

  return r;
}
