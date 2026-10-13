import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { errorHandler, notFoundHandler, asyncHandler } from '../../src/middleware/errorHandler.js';
import { ValidationError, NotFoundError } from '../../src/errors/index.js';

/**
 * Integration tests for the Express middleware stack
 * (request parsing -> route handlers -> notFoundHandler -> errorHandler).
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  app.get('/ok', (req, res) => res.json({ ok: true }));

  app.get(
    '/validation',
    asyncHandler(async () => {
      throw new ValidationError('Invalid thing', 'thing', 42);
    })
  );

  app.get(
    '/not-found',
    asyncHandler(async () => {
      throw new NotFoundError('Missing resource', 'thing');
    })
  );

  app.get(
    '/boom',
    asyncHandler(async () => {
      throw new Error('boom');
    })
  );

  app.get(
    '/zod',
    asyncHandler(async () => {
      z.object({ a: z.string() }).parse({});
    })
  );

  app.post('/echo', (req, res) => res.json({ got: req.body }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('middleware stack (integration)', () => {
  const app = buildApp();

  it('serves a successful route', async () => {
    const res = await request(app).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('maps ValidationError to 400 with details', async () => {
    const res = await request(app).get('/validation');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toMatchObject({ field: 'thing', value: 42 });
  });

  it('maps NotFoundError to 404', async () => {
    const res = await request(app).get('/not-found');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.details.resource).toBe('thing');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    expect(res.body.error.message).not.toContain('boom');
  });

  it('maps ZodError to 400 with field-level details', async () => {
    const res = await request(app).get('/zod');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toEqual([
      expect.objectContaining({ field: 'a' }),
    ]);
  });

  it('returns INVALID_JSON for malformed request bodies', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{ not valid json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
