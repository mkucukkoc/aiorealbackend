export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Avenia API',
    version: '2.0.0',
    description: 'Avenia AI Chat Application Backend API - Complete Documentation',
    contact: {
      name: 'Avenia Team',
      email: 'support@aveniaichat.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'https://google-auth-e4er.onrender.com',
      description: 'Production server',
    },
    {
      url: 'http://localhost:4000',
      description: 'Development server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from authentication endpoints',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false,
          },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                example: 'VALIDATION_ERROR',
              },
              message: {
                type: 'string',
                example: 'Invalid input data',
              },
              status_code: {
                type: 'integer',
                example: 400,
              },
            },
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
          request_id: {
            type: 'string',
            example: 'req_123456789',
          },
        },
      },
      Success: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          data: {
            type: 'object',
            description: 'Response data',
          },
          message: {
            type: 'string',
            example: 'Operation successful',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: '123e4567-e89b-12d3-a456-426614174000',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'user@example.com',
          },
          name: {
            type: 'string',
            example: 'John Doe',
          },
          avatar: {
            type: 'string',
            example: 'https://example.com/avatar.jpg',
          },
          isEmailVerified: {
            type: 'boolean',
            example: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
          lastLoginAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          data: {
            type: 'object',
            properties: {
              user: {
                $ref: '#/components/schemas/User',
              },
              accessToken: {
                type: 'string',
                example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              },
              refreshToken: {
                type: 'string',
                example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
              },
              sessionId: {
                type: 'string',
                example: 'sess_123456789',
              },
              firebaseCustomToken: {
                type: 'string',
                description: 'Firebase custom auth token for client-side synchronization',
                example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9...',
              },
            },
          },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            example: 'New Message',
          },
          body: {
            type: 'string',
            example: 'You have a new message',
          },
          data: {
            type: 'object',
            additionalProperties: true,
          },
          sound: {
            type: 'string',
            example: 'default',
          },
          badge: {
            type: 'number',
            example: 1,
          },
        },
      },
      PremiumStatus: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            example: 'user_123',
          },
          premium: {
            type: 'boolean',
            example: true,
          },
          premiumStatus: {
            type: 'string',
            nullable: true,
            enum: ['monthly', 'annual', null],
            example: 'monthly',
          },
          premiumExpiresAt: {
            type: 'string',
            format: 'date-time',
            example: '2025-01-01T00:00:00.000Z',
          },
          entitlementProductId: {
            type: 'string',
            example: 'com.avenia.premium.monthly',
          },
          entitlementEnvironment: {
            type: 'string',
            example: 'production',
          },
          entitlementIds: {
            type: 'array',
            items: { type: 'string' },
          },
          isSandboxOnly: {
            type: 'boolean',
            example: false,
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
          lastSyncSource: {
            type: 'string',
            example: 'restore_endpoint',
          },
        },
      },
      PremiumCustomerInfoRequest: {
        type: 'object',
        properties: {
          customerInfo: {
            type: 'object',
            description: 'RevenueCat customer info payload',
          },
          platform: {
            type: 'string',
            example: 'ios',
          },
          source: {
            type: 'string',
            example: 'purchase_flow',
          },
          requestId: {
            type: 'string',
            example: 'req_sync_123',
          },
        },
        required: ['customerInfo'],
      },
      PremiumRestoreRequest: {
        type: 'object',
        properties: {
          appUserId: {
            type: 'string',
            example: 'user_123',
          },
          requestId: {
            type: 'string',
            example: 'restore_btn_2024-11-16',
          },
          source: {
            type: 'string',
            example: 'settings_screen',
          },
        },
      },
    },
  },
  paths: {
    // ==================== HEALTH CHECK ====================
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Check if the server is running and healthy',
        tags: ['System'],
        responses: {
          200: { 
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    timestamp: { type: 'string', format: 'date-time' },
                    version: { type: 'string', example: '1.0.0' }
                  }
                }
              }
            }
          },
        },
      },
    },

    // ==================== WEBHOOKS ====================
    '/api/v1/webhooks/revenuecat': {
      post: {
        summary: 'RevenueCat webhook (v1)',
        description: 'Receives subscription lifecycle events from RevenueCat. Authenticated via static secret in the `Authorization` header.',
        tags: ['Webhooks'],
        security: [], // custom header, not Bearer auth
        parameters: [
          {
            name: 'Authorization',
            in: 'header',
            required: true,
            schema: { type: 'string', example: 'my-secret-token' },
            description: 'Must match `REVENUECAT_WEBHOOK_SECRET` environment variable'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Raw RevenueCat webhook payload',
              }
            }
          }
        },
        responses: {
          200: { description: 'Webhook processed successfully' },
          400: { description: 'Missing or invalid user information' },
          401: { description: 'Invalid Authorization header' },
          500: { description: 'Internal server error while processing event' }
        }
      }
    },

    '/webhooks/revenuecat': {
      post: {
        summary: 'RevenueCat webhook (legacy path)',
        description: 'Legacy path for RevenueCat webhook events. Identical behaviour to `/api/v1/webhooks/revenuecat`.',
        tags: ['Webhooks'],
        security: [],
        parameters: [
          {
            name: 'Authorization',
            in: 'header',
            required: true,
            schema: { type: 'string', example: 'my-secret-token' },
            description: 'Must match `REVENUECAT_WEBHOOK_SECRET` environment variable'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Raw RevenueCat webhook payload',
              }
            }
          }
        },
        responses: {
          200: { description: 'Webhook processed successfully' },
          400: { description: 'Missing or invalid user information' },
          401: { description: 'Invalid Authorization header' },
          500: { description: 'Internal server error while processing event' }
        }
      }
    },

    // ==================== AUTHENTICATION ====================
    '/api/v1/auth/register': {
      post: {
        summary: 'Register new user',
        description: 'Create a new user account with email and password',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  password: { type: 'string', minLength: 8, example: 'password123' },
                  name: { type: 'string', example: 'John Doe' },
                  deviceId: { type: 'string', example: 'device_123' },
                  deviceName: { type: 'string', example: 'iPhone 15' }
                },
                required: ['email', 'password', 'name', 'deviceId']
              }
            }
          }
        },
        responses: {
          201: { 
            description: 'User registered successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthResponse' }
              }
            }
          },
          400: { description: 'Invalid request data' },
          409: { description: 'User already exists' }
        }
      }
    },

    '/api/v1/auth/login': {
      post: {
        summary: 'Login user',
        description: 'Authenticate user with email and password',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  password: { type: 'string', example: 'password123' },
                  deviceId: { type: 'string', example: 'device_123' },
                  deviceName: { type: 'string', example: 'iPhone 15' }
                },
                required: ['email', 'password', 'deviceId']
              }
            }
          }
        },
        responses: {
          200: { 
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthResponse' }
              }
            }
          },
          401: { description: 'Invalid credentials' },
          400: { description: 'Invalid request data' }
        }
      }
    },

    '/api/v1/auth/refresh': {
      post: {
        summary: 'Refresh access token',
        description: 'Get new access token using refresh token',
        tags: ['Authentication'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                  deviceId: { type: 'string', example: 'device_123' }
                },
                required: ['refreshToken', 'deviceId']
              }
            }
          }
        },
        responses: {
          200: { 
            description: 'Token refreshed successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthResponse' }
              }
            }
          },
          401: { description: 'Invalid refresh token' }
        }
      }
    },

    '/api/v1/auth/logout': {
      post: {
        summary: 'Logout user',
        description: 'Revoke refresh token for current device',
        tags: ['Authentication'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string', example: 'device_123' }
                },
                required: ['deviceId']
              }
            }
          }
        },
        responses: {
          200: { description: 'Logout successful' },
          401: { description: 'Unauthorized' }
        }
      }
    },

    '/api/v1/auth/logout-all': {
      post: {
        summary: 'Logout from all devices',
        description: 'Revoke all refresh tokens for the user',
        tags: ['Authentication'],
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Logout from all devices successful' },
          401: { description: 'Unauthorized' }
        }
      }
    },

    '/api/v1/auth/me': {
      get: {
        summary: 'Get current user',
        description: 'Get information about the currently authenticated user',
        tags: ['Authentication'],
        security: [{ BearerAuth: [] }],
        responses: {
          200: { 
            description: 'User information retrieved successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' }
              }
            }
          },
          401: { description: 'Unauthorized' }
        }
      }
    },

    // ==================== EMAIL OTP ====================
    '/api/v1/auth/email/start': {
      post: {
        summary: 'Request OTP code',
        description: 'Send OTP verification code to email',
        tags: ['Email OTP'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' }
                },
                required: ['email']
              }
            }
          }
        },
        responses: {
          200: { description: 'OTP sent successfully' },
          400: { description: 'Invalid email' },
          429: { description: 'Rate limited' }
        }
      }
    },

    '/api/v1/auth/email/verify': {
      post: {
        summary: 'Verify OTP and login',
        description: 'Verify OTP code and complete authentication',
        tags: ['Email OTP'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' },
                  otp: { type: 'string', example: '123456' },
                  deviceId: { type: 'string', example: 'device_123' },
                  deviceName: { type: 'string', example: 'iPhone 15' }
                },
                required: ['email', 'otp', 'deviceId']
              }
            }
          }
        },
        responses: {
          200: { 
            description: 'OTP verified and login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthResponse' }
              }
            }
          },
          400: { description: 'Invalid OTP or request' }
        }
      }
    },

    // ==================== GOOGLE AUTH ====================
    '/api/v1/auth/google/start': {
      post: {
        summary: 'Start Google authentication',
        description: 'Initiate Google OAuth flow',
        tags: ['Google Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string', example: 'device_123' },
                  deviceName: { type: 'string', example: 'iPhone 15' }
                },
                required: ['deviceId']
              }
            }
          }
        },
        responses: {
          200: { 
            description: 'Google auth URL generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    authUrl: { type: 'string', example: 'https://accounts.google.com/oauth/authorize?...' },
                    sessionId: { type: 'string', example: 'google_session_123' }
                  }
                }
              }
            }
          }
        }
      }
    },

    '/api/v1/auth/google/status/{id}': {
      get: {
        summary: 'Check Google auth status',
        description: 'Check if Google authentication is completed',
        tags: ['Google Auth'],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
            description: 'Session ID from start request'
          }
        ],
        responses: {
          200: { 
            description: 'Auth status retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ready: { type: 'boolean', example: true },
                    result: { $ref: '#/components/schemas/AuthResponse' }
                  }
                }
              }
            }
          }
        }
      }
    },

    '/api/v1/auth/google/callback': {
      get: {
        summary: 'Google OAuth callback',
        description: 'Handle Google OAuth callback',
        tags: ['Google Auth'],
        parameters: [
          {
            in: 'query',
            name: 'code',
            schema: { type: 'string' },
            description: 'Authorization code from Google'
          },
          {
            in: 'query',
            name: 'state',
            schema: { type: 'string' },
            description: 'State parameter for security'
          }
        ],
        responses: {
          200: { description: 'Google auth completed' },
          400: { description: 'Invalid callback parameters' }
        }
      }
    },

    // ==================== APPLE AUTH ====================
    '/api/v1/auth/apple/start': {
      post: {
        summary: 'Start Apple authentication',
        description: 'Initiate Apple Sign-In flow',
        tags: ['Apple Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string', example: 'device_123' },
                  deviceName: { type: 'string', example: 'iPhone 15' }
                },
                required: ['deviceId']
              }
            }
          }
        },
        responses: {
          200: { 
            description: 'Apple auth URL generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    authUrl: { type: 'string', example: 'https://appleid.apple.com/auth/authorize?...' },
                    sessionId: { type: 'string', example: 'apple_session_123' }
                  }
                }
              }
            }
          }
        }
      }
    },

    '/api/v1/auth/apple/status/{id}': {
      get: {
        summary: 'Check Apple auth status',
        description: 'Check if Apple authentication is completed',
        tags: ['Apple Auth'],
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
            description: 'Session ID from start request'
          }
        ],
        responses: {
          200: { 
            description: 'Auth status retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ready: { type: 'boolean', example: true },
                    result: { $ref: '#/components/schemas/AuthResponse' }
                  }
                }
              }
            }
          }
        }
      }
    },

    '/api/v1/auth/apple/callback': {
      post: {
        summary: 'Apple Sign-In callback',
        description: 'Handle Apple Sign-In callback',
        tags: ['Apple Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  code: { type: 'string', description: 'Authorization code from Apple' },
                  state: { type: 'string', description: 'State parameter for security' },
                  idToken: { type: 'string', description: 'ID token from Apple' }
                },
                required: ['code', 'state']
              }
            }
          }
        },
        responses: {
          200: { description: 'Apple auth completed' },
          400: { description: 'Invalid callback parameters' }
        }
      }
    },

    // ==================== PASSWORD RESET ====================
    '/api/v1/auth/password-reset/request': {
      post: {
        summary: 'Request password reset',
        description: 'Send password reset email to user',
        tags: ['Password Reset'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', example: 'user@example.com' }
                },
                required: ['email']
              }
            }
          }
        },
        responses: {
          200: { description: 'Password reset email sent' },
          400: { description: 'Invalid email' },
          404: { description: 'User not found' }
        }
      }
    },

    '/api/v1/auth/password-reset/confirm': {
      post: {
        summary: 'Confirm password reset',
        description: 'Reset password using token from email',
        tags: ['Password Reset'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string', example: 'reset_token_123' },
                  newPassword: { type: 'string', minLength: 8, example: 'newpassword123' }
                },
                required: ['token', 'newPassword']
              }
            }
          }
        },
        responses: {
          200: { description: 'Password reset successful' },
          400: { description: 'Invalid token or password' },
          401: { description: 'Token expired' }
        }
      }
    },

    // ==================== PDF READ ====================













    '/api/v1/pdfread/health': {
      get: {
        summary: 'PDF Read service health check',
        description: 'Check if PDF Read service is available',
        tags: ['PDF Read'],
        responses: {
          200: { 
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'healthy' },
                        timestamp: { type: 'string', format: 'date-time' }
                      }
                    }
                  }
                }
              }
            }
          },
          503: { description: 'Service unavailable' }
        }
      }
    },

    // ==================== NOTIFICATIONS ====================
    '/api/v1/notifications/tokens': {
      post: {
        summary: 'Save push notification token',
        description: 'Save user\'s push notification token for device',
        tags: ['Notifications'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expoPushToken: { type: 'string', example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' },
                  deviceId: { type: 'string', example: 'device_123' },
                  platform: { type: 'string', enum: ['ios', 'android', 'web'], example: 'ios' }
                },
                required: ['expoPushToken', 'deviceId', 'platform']
              }
            }
          }
        },
        responses: {
          200: { description: 'Token saved successfully' },
          401: { description: 'Unauthorized' },
          400: { description: 'Invalid request data' }
        }
      }
    },

    '/api/v1/notifications/tokens/{deviceId}': {
      delete: {
        summary: 'Remove push notification token',
        description: 'Remove push notification token for specific device',
        tags: ['Notifications'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            in: 'path',
            name: 'deviceId',
            required: true,
            schema: { type: 'string' },
            description: 'Device ID to remove token for'
          }
        ],
        responses: {
          200: { description: 'Token removed successfully' },
          401: { description: 'Unauthorized' },
          404: { description: 'Token not found' }
        }
      }
    },

    '/api/v1/notifications/send': {
      post: {
        summary: 'Send notification',
        description: 'Send push notification to specific users',
        tags: ['Notifications'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  userIds: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: 'Array of user IDs to send notification to'
                  },
                  title: { type: 'string', example: 'New Message' },
                  body: { type: 'string', example: 'You have a new message' },
                  data: { 
                    type: 'object', 
                    additionalProperties: true,
                    description: 'Additional data to send with notification'
                  },
                  sound: { type: 'string', example: 'default' },
                  badge: { type: 'number', example: 1 },
                  priority: { type: 'string', enum: ['default', 'normal', 'high'], example: 'normal' },
                  channelId: { type: 'string', example: 'messages' },
                  category: { type: 'string', example: 'message' }
                },
                required: ['title', 'body']
              }
            }
          }
        },
        responses: {
          200: { description: 'Notification sent successfully' },
          401: { description: 'Unauthorized' },
          400: { description: 'Invalid request data' }
        }
      }
    },

    '/api/v1/notifications/send/bulk': {
      post: {
        summary: 'Send bulk notification',
        description: 'Send push notification to multiple devices using tokens',
        tags: ['Notifications'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expoPushTokens: { 
                    type: 'array', 
                    items: { type: 'string' },
                    description: 'Array of Expo push tokens'
                  },
                  title: { type: 'string', example: 'Bulk Notification' },
                  body: { type: 'string', example: 'This is a bulk notification' },
                  data: { 
                    type: 'object', 
                    additionalProperties: true,
                    description: 'Additional data to send with notification'
                  }
                },
                required: ['expoPushTokens', 'title', 'body']
              }
            }
          }
        },
        responses: {
          200: { description: 'Bulk notification sent successfully' },
          401: { description: 'Unauthorized' },
          400: { description: 'Invalid request data' }
        }
      }
    },

    '/api/v1/notifications/stats': {
      get: {
        summary: 'Get notification statistics',
        description: 'Get notification delivery and engagement statistics',
        tags: ['Notifications'],
        security: [{ BearerAuth: [] }],
        responses: {
          200: { 
            description: 'Statistics retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        totalSent: { type: 'number', example: 1500 },
                        totalDelivered: { type: 'number', example: 1450 },
                        totalOpened: { type: 'number', example: 1200 },
                        deliveryRate: { type: 'number', example: 0.967 },
                        openRate: { type: 'number', example: 0.827 }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { description: 'Unauthorized' }
        }
      }
    },

    // ==================== DELETE ACCOUNT ====================
    '/api/v1/delete-account': {
      post: {
        summary: 'Initiate account deletion',
        description: 'Start the account deletion process. This will check for active subscriptions, perform soft-delete, and schedule background cleanup jobs.',
        tags: ['Delete Account'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deleteReason: {
                    type: 'string',
                    enum: ['security', 'dissatisfied', 'not_using', 'switching_service', 'other'],
                    example: 'not_using',
                    description: 'Reason for account deletion'
                  },
                  deleteReasonNote: {
                    type: 'string',
                    maxLength: 1000,
                    example: 'I no longer use this app',
                    description: 'Optional additional details about deletion reason'
                  },
                  confirmPermanentDeletion: {
                    type: 'boolean',
                    example: true,
                    description: 'Must be true to confirm permanent deletion'
                  },
                  gdprAcknowledged: {
                    type: 'boolean',
                    example: true,
                    description: 'Must be true to acknowledge GDPR/KVKK notice'
                  },
                  skipDataExport: {
                    type: 'boolean',
                    example: false,
                    description: 'Skip data export before deletion'
                  },
                  initiatedFrom: {
                    type: 'string',
                    maxLength: 50,
                    example: 'settings_screen',
                    description: 'Where the deletion was initiated from'
                  },
                  appVersion: {
                    type: 'string',
                    maxLength: 50,
                    example: '1.0.0',
                    description: 'App version'
                  },
                  locale: {
                    type: 'string',
                    maxLength: 10,
                    example: 'tr',
                    description: 'User locale'
                  },
                  platform: {
                    type: 'string',
                    maxLength: 50,
                    example: 'ios',
                    description: 'Platform (ios/android)'
                  },
                  anonymous: {
                    type: 'boolean',
                    example: false,
                    description: 'Whether user is anonymous'
                  }
                },
                required: ['deleteReason', 'confirmPermanentDeletion', 'gdprAcknowledged']
              }
            }
          }
        },
        responses: {
          202: {
            description: 'Deletion process initiated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        jobId: { type: 'string', example: 'job_123456789' },
                        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'], example: 'pending' },
                        providersToUnlink: {
                          type: 'array',
                          items: { type: 'string' },
                          example: ['google.com', 'apple.com'],
                          description: 'Firebase Auth providers to unlink on client side'
                        },
                        restoreUntil: {
                          type: 'string',
                          format: 'date-time',
                          example: '2024-02-14T12:00:00.000Z',
                          description: 'Date until which account can be restored (30 days)'
                        },
                        message: { type: 'string', example: 'Delete account işlemi başlatıldı' }
                      }
                    }
                  }
                }
              }
            }
          },
          400: { description: 'Invalid request data or validation error' },
          401: { description: 'Unauthorized' },
          403: { description: 'Active subscription exists or legal hold' },
          409: { description: 'Deletion already in progress' },
          429: { description: 'Rate limit exceeded' }
        }
      }
    },

    '/api/v1/delete-account/export': {
      post: {
        summary: 'Export user data (GDPR)',
        description: 'Generate a downloadable archive of all user data before account deletion',
        tags: ['Delete Account'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  forceRegenerate: {
                    type: 'boolean',
                    example: false,
                    description: 'Force regeneration even if export exists'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Data export generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        archiveBase64: { type: 'string', description: 'Base64 encoded gzipped JSON archive' },
                        fileName: { type: 'string', example: 'avenia-export-user123-1234567890.json.gz' },
                        size: { type: 'number', example: 102400, description: 'Size in bytes' },
                        generatedAt: { type: 'string', format: 'date-time' },
                        expiresAt: { type: 'string', format: 'date-time', description: 'Download link expiration' }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { description: 'Unauthorized' },
          403: { description: 'Data export disabled' },
          500: { description: 'Export generation failed' }
        }
      }
    },

    '/api/v1/delete-account/restore': {
      post: {
        summary: 'Restore deleted account',
        description: 'Restore a deleted account within the 30-day restoration window. Premium subscriptions are NOT automatically restored.',
        tags: ['Delete Account'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  confirmationCode: {
                    type: 'string',
                    minLength: 4,
                    maxLength: 12,
                    description: 'Optional confirmation code sent via email'
                  },
                  reason: {
                    type: 'string',
                    maxLength: 500,
                    example: 'I changed my mind',
                    description: 'Reason for restoration'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Account restored successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        restored: { type: 'boolean', example: true },
                        restoredAt: { type: 'string', format: 'date-time' },
                        message: { type: 'string', example: 'Hesabınız geri alındı' }
                      }
                    }
                  }
                }
              }
            }
          },
          400: { description: 'Restoration window expired or invalid request' },
          401: { description: 'Unauthorized' },
          404: { description: 'No deletion record found' }
        }
      }
    },

    '/api/v1/delete-account/jobs/:jobId': {
      get: {
        summary: 'Get deletion job status',
        description: 'Check the status of an account deletion job',
        tags: ['Delete Account'],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            in: 'path',
            name: 'jobId',
            required: true,
            schema: { type: 'string', minLength: 10 },
            description: 'Deletion job ID'
          }
        ],
        responses: {
          200: {
            description: 'Job status retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', example: 'job_123456789' },
                        userId: { type: 'string' },
                        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
                        reason: { type: 'string' },
                        phases: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: { type: 'string' },
                              status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
                              startedAt: { type: 'string', format: 'date-time' },
                              completedAt: { type: 'string', format: 'date-time' },
                              error: { type: 'string' }
                            }
                          }
                        },
                        metrics: {
                          type: 'object',
                          properties: {
                            firestoreDocsDeleted: { type: 'number' },
                            storageObjectsDeleted: { type: 'number' },
                            durationMs: { type: 'number' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { description: 'Unauthorized' },
          404: { description: 'Job not found' }
        }
      }
    },

    '/api/v1/delete-account/jobs/latest': {
      get: {
        summary: 'Get latest deletion job for user',
        description: 'Get the most recent account deletion job for the authenticated user',
        tags: ['Delete Account'],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Latest job retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      description: 'Same structure as /jobs/:jobId response'
                    }
                  }
                }
              }
            }
          },
          401: { description: 'Unauthorized' },
          404: { description: 'No deletion job found' }
        }
      }
    },

    // ==================== PREMIUM ====================
    '/api/v1/premium/customer-info': {
      post: {
        summary: 'Sync premium status with customer info',
        description: 'RevenueCat customerInfo payloadını backend’e göndererek premiumusers kaydını günceller.',
        tags: ['Premium'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PremiumCustomerInfoRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Premium bilgileri güncellendi',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    {
                      type: 'object',
                      properties: {
                        data: { $ref: '#/components/schemas/PremiumStatus' },
                      },
                    },
                  ],
                },
              },
            },
          },
          400: { description: 'Geçersiz payload' },
          401: { description: 'Authorization required' },
          500: { description: 'Premium senkronizasyonu başarısız' },
        },
      },
    },

    '/api/v1/premium/restore': {
      post: {
        summary: 'Restore premium purchases',
        description: 'RevenueCat üzerinden abonelik durumunu kontrol eder ve Firestore kaydını günceller.',
        tags: ['Premium'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PremiumRestoreRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Restore işlemi sonucu',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    {
                      type: 'object',
                      properties: {
                        data: { $ref: '#/components/schemas/PremiumStatus' },
                        message: { type: 'string' },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { description: 'Authorization required' },
          404: { description: 'Aktif abonelik bulunamadı' },
          500: { description: 'Restore işlemi başarısız' },
        },
      },
    },

    '/api/v1/premium/sync': {
      post: {
        summary: 'Manual premium sync',
        description: 'RevenueCat appUserId kullanarak manuel premium senkronizasyonu yapar.',
        tags: ['Premium'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PremiumRestoreRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Sync sonucu',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    {
                      type: 'object',
                      properties: {
                        data: { $ref: '#/components/schemas/PremiumStatus' },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { description: 'Authorization required' },
          404: { description: 'Aktif abonelik bulunamadı' },
          500: { description: 'Sync başarısız' },
        },
      },
    },

    '/api/v1/premium/status': {
      get: {
        summary: 'Get premium status',
        description: 'Kullanıcının premiumusers kaydını döndürür.',
        tags: ['Premium'],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Premium durumu',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    {
                      type: 'object',
                      properties: {
                        data: { $ref: '#/components/schemas/PremiumStatus' },
                      },
                    },
                  ],
                },
              },
            },
          },
          401: { description: 'Authorization required' },
          404: { description: 'Premium kaydı bulunamadı' },
          500: { description: 'Premium durumu alınamadı' },
        },
      },
    },

    // ==================== PRESENTATION ====================
  },
  tags: [
    { name: 'System', description: 'System health and status endpoints' },
    { name: 'Authentication', description: 'User authentication and authorization' },
    { name: 'Email OTP', description: 'Email-based OTP authentication' },
    { name: 'Google Auth', description: 'Google OAuth authentication' },
    { name: 'Apple Auth', description: 'Apple Sign-In authentication' },
    { name: 'Password Reset', description: 'Password reset functionality' },
    { name: 'PDF Read', description: 'PDF processing and AI analysis' },
    { name: 'Notifications', description: 'Push notification management' },
    { name: 'Delete Account', description: 'Account deletion and data export (GDPR/KVKK compliant)' },
    { name: 'Premium', description: 'Premium abonelik yönetimi ve senkronizasyonu' }
  ]
} as const;