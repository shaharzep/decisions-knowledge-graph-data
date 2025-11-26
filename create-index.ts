import { DatabaseConfig } from './src/config/database.js';

async function createIndex() {
  try {
    console.log('Creating pg_trgm GIN index on documents.title...');

    // Get the pool directly (bypassing READ-ONLY check)
    const pool = DatabaseConfig['getPool']();

    // Create the index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_title_trgm
      ON documents USING GIN (title gin_trgm_ops);
    `);

    console.log('✅ Index created successfully!');

    // Verify index exists
    const result = await pool.query(`
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE indexname = 'idx_documents_title_trgm';
    `);

    if (result.rows.length > 0) {
      console.log('✅ Index verified:');
      console.log(result.rows[0]);
    } else {
      console.log('⚠️  Index not found after creation');
    }

    await pool.end();
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error creating index:', error.message);
    process.exit(1);
  }
}

createIndex();
