-- Create GIN index on documents.title for fast SIMILARITY() queries
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING GIN (title gin_trgm_ops);

-- Verify index was created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE indexname = 'idx_documents_title_trgm';
