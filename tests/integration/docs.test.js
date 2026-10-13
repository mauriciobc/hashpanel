import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { docsRoutes } from '../../src/server/routes/docs.js';

describe('GET /api/docs', () => {
  it('serves a valid OpenAPI document', async () => {
    const app = express();
    app.use('/api/docs', docsRoutes);

    const res = await request(app).get('/api/docs');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('HashPanel API');
    expect(res.body.paths['/health']).toBeDefined();
    expect(res.body.paths['/api/dashboard/stats']).toBeDefined();
    expect(res.body.paths['/api/trending']).toBeDefined();
  });
});
