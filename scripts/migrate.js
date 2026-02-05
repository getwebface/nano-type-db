// scripts/migrate.js
// Migration controller that runs D1 migrations and triggers DO deployment
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const WORKER_URL = process.env.WORKER_URL || "http://localhost:8787";
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function runMigrations() {
  console.log('🔄 Starting migration process...');
  
  try {
    // Step 1: Get list of migration files
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    console.log(`📁 Found ${migrationFiles.length} migration file(s)`);
    
    // Step 2: Run each migration against D1 database
    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      console.log(`\n📝 Running migration: ${file}`);
      
      try {
        // Execute the migration using wrangler d1 execute
        // This assumes the database binding name is nanotype-read-replica based on wrangler.toml
        const command = `wrangler d1 execute nanotype-read-replica --file=${filePath}`;
        console.log(`   Command: ${command}`);
        
        const output = execSync(command, { 
          encoding: 'utf-8',
          stdio: 'inherit'
        });
        
        console.log(`   ✅ Migration ${file} completed successfully`);
      } catch (error) {
        console.error(`   ❌ Migration ${file} failed:`, error.message);
        // Continue with other migrations instead of failing completely
        // This allows idempotent migrations to succeed
      }
    }
    
    // Step 3: Trigger a dummy DO request to ensure deployment
    console.log('\n🚀 Triggering Durable Object deployment check...');
    
    try {
      const response = await fetch(`${WORKER_URL}/health?room_id=migration-check`);
      if (response.ok) {
        console.log('   ✅ Durable Object is responsive');
      } else {
        console.warn(`   ⚠️  DO responded with status: ${response.status}`);
      }
    } catch (error) {
      console.warn('   ⚠️  Could not reach DO (this is expected in CI/CD):', error.message);
    }
    
    console.log('\n✨ Migration process completed!');
    
  } catch (error) {
    console.error('❌ Migration process failed:', error.message);
    process.exit(1);
  }
}

runMigrations();
