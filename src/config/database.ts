import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

/**
 * PostgreSQL Database Configuration
 *
 * IMPORTANT: This is a READ-ONLY connection pool.
 * NO write operations should be performed through this connection.
 * All queries must be SELECT statements only.
 */
export class DatabaseConfig {
  private static pool: pg.Pool | null = null;

  /**
   * Get or create the PostgreSQL connection pool
   */
  static getPool(): pg.Pool {
    if (!this.pool) {
      this.pool = new Pool({
        host: process.env.PGHOST,
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || process.env.POSTGRES_DB,
        // Connection pool settings
        max: 200, // Maximum number of clients (matches mapping concurrencyLimit)
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000, // 30 seconds to acquire connection
      });

      // Log connection info (without password)
      console.log(`📊 Database pool initialized: ${process.env.PGUSER}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`);
    }

    return this.pool;
  }

  /**
   * Execute a READ-ONLY query
   * This method enforces that only SELECT queries are allowed
   *
   * @param query SQL query (must be SELECT)
   * @param params Query parameters
   * @returns Query result rows
   */
  static async executeReadOnlyQuery<T extends pg.QueryResultRow = any>(
    query: string,
    params: any[] = []
  ): Promise<T[]> {
    // Security check: Only allow SELECT queries
    const trimmedQuery = query.trim().toUpperCase();
    if (!trimmedQuery.startsWith('SELECT')) {
      throw new Error(
        'SECURITY VIOLATION: Only SELECT queries are allowed. ' +
        'This is a READ-ONLY database connection. ' +
        'No INSERT, UPDATE, DELETE, or other write operations are permitted.'
      );
    }

    const pool = this.getPool();

    try {
      const result = await pool.query<T>(query, params);
      return result.rows;
    } catch (error) {
      console.error('❌ Database query error:', error);
      throw error;
    }
  }

  /**
   * Test database connection
   */
  static async testConnection(): Promise<boolean> {
    try {
      const result = await this.executeReadOnlyQuery<{ now: Date }>(
        'SELECT NOW() as now'
      );
      console.log('✅ Database connection successful:', result[0].now);
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      return false;
    }
  }

  /**
   * Close the connection pool
   * Should be called when shutting down the application
   */
  static async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('🔌 Database pool closed');
    }
  }
}
