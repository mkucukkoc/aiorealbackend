import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
  keyValue?: any;
  errors?: any;
}

export class CustomError extends Error implements AppError {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// MongoDB/Database error handler
const handleMongoError = (error: any): AppError => {
  let message = 'Database error occurred';
  let statusCode = 500;

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    message = `${field} already exists`;
    statusCode = 400;
  } else if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map((err: any) => err.message);
    message = `Validation Error: ${errors.join(', ')}`;
    statusCode = 400;
  } else if (error.name === 'CastError') {
    message = `Invalid ${error.path}: ${error.value}`;
    statusCode = 400;
  }

  return new CustomError(message, statusCode);
};

// JWT error handler
const handleJWTError = (): AppError => {
  return new CustomError('Invalid token. Please log in again!', 401);
};

const handleJWTExpiredError = (): AppError => {
  return new CustomError('Your token has expired! Please log in again.', 401);
};

// Rate limit error handler
const handleRateLimitError = (): AppError => {
  return new CustomError('Too many requests from this IP, please try again later.', 429);
};

// Validation error handler
const handleValidationError = (error: any): AppError => {
  const errors = Object.values(error.errors).map((err: any) => err.message);
  const message = `Invalid input data: ${errors.join(', ')}`;
  return new CustomError(message, 400);
};

// Send error response
const sendErrorDev = (err: AppError, res: Response) => {
  res.status(err.statusCode || 500).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    path: res.req.url,
    method: res.req.method
  });
};

const sendErrorProd = (err: AppError, res: Response) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
      timestamp: new Date().toISOString(),
      requestId: res.get('X-Request-ID') || 'unknown'
    });
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('ERROR 💥', err);
    
    res.status(500).json({
      success: false,
      message: 'Something went wrong!',
      timestamp: new Date().toISOString(),
      requestId: res.get('X-Request-ID') || 'unknown'
    });
  }
};

// Global error handling middleware
export const globalErrorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  err.statusCode = err.statusCode || 500;
  err.isOperational = err.isOperational || false;

  // Log error details
  logger.error('Error occurred:', {
    message: err.message,
    statusCode: err.statusCode,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  let error = { ...err };
  error.message = err.message;

  // Handle specific error types
  if (err.name === 'ValidationError') error = handleValidationError(err);
  if ((err as any).code === 11000) error = handleMongoError(err);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
  if (err.message?.includes('rate limit')) error = handleRateLimitError();

  // Send error response based on environment
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

// Async error wrapper
export const catchAsync = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};

// 404 handler
export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new CustomError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

// Unhandled promise rejection handler
export const handleUnhandledRejection = () => {
  process.on('unhandledRejection', (err: Error) => {
    logger.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
    process.exit(1);
  });
};

// Uncaught exception handler
export const handleUncaughtException = () => {
  process.on('uncaughtException', (err: Error) => {
    logger.error({
      message: 'UNCAUGHT EXCEPTION! 💥 Shutting down...',
      error: err.message,
      stack: err.stack,
      name: err.name
    }, 'Uncaught Exception');
    logger.error({ err }, 'Uncaught Exception (fallback logging)');
    process.exit(1);
  });
};

