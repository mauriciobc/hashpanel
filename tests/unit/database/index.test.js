import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseService } from '../../../src/database/index.js';
import Database from 'better-sqlite3';
import path from 'path';

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  class MockDB {
    constructor() {
      this.pragma = vi.fn();
      this.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ total_records: 0 }),
        all: vi.fn().mockReturnValue([])
      });
      this.close = vi.fn();
    }
  }
  
  return {
    default: MockDB
  };
});

// Mock migrations
vi.mock('../../../src/database/migrations.js', () => ({
  runMigrations: vi.fn()
}));

describe('DatabaseService', () => {
  let dbService;
  const tempDbPath = path.join(process.cwd(), 'data', 'test-db.db');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DB_PATH = tempDbPath;
    dbService = new DatabaseService();
  });

  afterEach(() => {
    if (dbService) {
      dbService.close();
    }
  });

  it('should initialize connection with WAL mode and foreign keys', () => {
    const mockDb = dbService.db;
    
    expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON');
  });

  it('should return the database instance', () => {
    const db = dbService.getDatabase();
    expect(db).toBeDefined();
    expect(db).toBe(dbService.db);
  });

  it('should throw error if getting database when closed', () => {
    dbService.close();
    expect(() => dbService.getDatabase()).toThrow('Database connection is closed');
  });

  it('should perform health check correctly', () => {
    const mockDb = dbService.db;
    const mockPrepare = vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue({ '1': 1 }) });
    mockDb.prepare = mockPrepare;

    const health = dbService.healthCheck();
    expect(health.status).toBe('healthy');
    expect(mockPrepare).toHaveBeenCalledWith('SELECT 1');
  });

  it('should report unhealthy if health check fails', () => {
    const mockDb = dbService.db;
    mockDb.prepare = vi.fn().mockImplementation(() => {
      throw new Error('DB Error');
    });

    const health = dbService.healthCheck();
    expect(health.status).toBe('unhealthy');
    expect(health.error).toBe('DB Error');
  });
});
