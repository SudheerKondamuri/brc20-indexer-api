'use strict';

const request = require('supertest');

// Mock database module
jest.mock('../src/db/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
  getLastIndexedHeight: jest.fn().mockResolvedValue(0),
  setLastIndexedHeight: jest.fn(),
  closePool: jest.fn(),
}));

// Mock bitcoin RPC
jest.mock('../src/bitcoin/rpc', () => ({
  getBlockCount: jest.fn().mockResolvedValue(100),
  rpcCall: jest.fn(),
}));

const { createApp } = require('../src/api/app');
const db = require('../src/db/database');

let app;

beforeAll(() => {
  app = createApp();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /health', () => {
  test('returns 200 when DB is healthy', async () => {
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  test('returns 503 when DB is down', async () => {
    db.query.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });
});

describe('GET /api/v1/brc20/token', () => {
  test('returns 400 when ticker is missing', async () => {
    const res = await request(app).get('/api/v1/brc20/token');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/ticker/i);
  });

  test('returns 404 when token does not exist', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app).get('/api/v1/brc20/token?ticker=FAKE');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 200 with correct token data', async () => {
    const mockToken = {
      ticker: 'ordi',
      max_supply: '21000000',
      minted_supply: '10000000',
      limit_per_mint: '1000',
      decimal_places: 18,
      deploy_timestamp: '2024-01-01T00:00:00.000Z',
    };
    db.query.mockResolvedValue({ rows: [mockToken], rowCount: 1 });

    const res = await request(app).get('/api/v1/brc20/token?ticker=ordi');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('ordi');
    expect(res.body.max_supply).toBe('21000000');
    expect(res.body.minted_supply).toBe('10000000');
    expect(res.body.limit_per_mint).toBe('1000');
    expect(res.body.decimal_places).toBe(18);
  });
});

describe('GET /api/v1/brc20/balance', () => {
  test('returns 400 when ticker is missing', async () => {
    const res = await request(app).get('/api/v1/brc20/balance?address=bc1abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ticker/i);
  });

  test('returns 400 when address is missing', async () => {
    const res = await request(app).get('/api/v1/brc20/balance?ticker=ordi');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/address/i);
  });

  test('returns 404 when token does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // token check
    const res = await request(app).get('/api/v1/brc20/balance?ticker=NOPE&address=bc1abc');
    expect(res.status).toBe(404);
  });

  test('returns zero balance for address with no holdings', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // token exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no balance

    const res = await request(app).get('/api/v1/brc20/balance?ticker=ordi&address=bc1notexist');
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe('0');
    expect(res.body.available_balance).toBe('0');
    expect(res.body.transferable_balance).toBe('0');
  });

  test('returns correct balance for address with holdings', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // token exists
      .mockResolvedValueOnce({
        rows: [{ available_balance: '800', transferable_balance: '200', total_balance: '1000' }],
        rowCount: 1,
      });

    const res = await request(app).get('/api/v1/brc20/balance?ticker=ordi&address=bc1holder');
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe('1000');
    expect(res.body.available_balance).toBe('800');
    expect(res.body.transferable_balance).toBe('200');
  });
});

describe('GET /api/v1/brc20/holders', () => {
  test('returns 400 when ticker is missing', async () => {
    const res = await request(app).get('/api/v1/brc20/holders');
    expect(res.status).toBe(400);
  });

  test('returns 404 when token does not exist', async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/v1/brc20/holders?ticker=NOPE');
    expect(res.status).toBe(404);
  });

  test('returns paginated holders list', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // token exists
      .mockResolvedValueOnce({
        rows: [
          { address: 'addr1', balance: '5000' },
          { address: 'addr2', balance: '3000' },
        ],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [{ total: '10' }], rowCount: 1 }); // total count

    const res = await request(app).get('/api/v1/brc20/holders?ticker=ordi&limit=2&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.holders).toHaveLength(2);
    expect(res.body.total).toBe(10);
    expect(res.body.holders[0].address).toBe('addr1');
    expect(res.body.holders[0].balance).toBe('5000');
  });

  test('applies default limit and offset', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // token exists
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

    const res = await request(app).get('/api/v1/brc20/holders?ticker=ordi');
    expect(res.status).toBe(200);
    expect(res.body.holders).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('404 handler', () => {
  test('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/api/v1/unknown/endpoint');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
