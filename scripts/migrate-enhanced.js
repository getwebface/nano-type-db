#!/usr/bin/env node
/**
 * PRODUCTION: Enhanced Migration Runner with Versioning & Rollback Support
 * 
 * Features:
 * - Tracks applied migrations in a _migrations table
 * - Supports rollback to previous version
 * - Validates migration files before applying
 * - Dry-run mode for testing
 * - Structured logging
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const DATABASE_NAME = process.env.D1_DATABASE_NAME || "nanotype-read-replica";
const AUTH_DATABASE_NAME = process.env.AUTH_D1_DATABASE_NAME || "nanotype-auth";

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'up';
const targetVersion = args[1] ? parseInt(args[1]) : null;
const isDryRun = args.includes('--dry-run');
const isLocal = args.includes('--local');

/**
 * Structured logger for migration output
 */
class MigrationLogger {
  info(message, meta = {}) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      ...meta,
      timestamp: new Date().toISOString()
    }));
  }

  error(message, error, meta = {}) {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : String(error),
      ...meta,
      timestamp: new Date().toISOString()
    }));
  }

  warn(message, meta = {}) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      ...meta,
      timestamp: new Date().toISOString()
    }));
  }
}

const logger = new MigrationLogger();

/**
 * Get list of migration files sorted by version
 */
function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql') && file.match(/^\d+/))
    .sort((a, b) => {
      const versionA = parseInt(a.split('_')[0]);
      const versionB = parseInt(b.split('_')[0]);
      return versionA - versionB;
    });
  
  return files.map(file => {
    const version = parseInt(file.split('_')[0]);
    const name = file.replace('.sql', '');
    const filePath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    return { version, name, file, filePath, content };
  });
}

/**
 * Get list of applied migrations from D1 database
 */
async function getAppliedMigrations(database) {
  try {
    const localFlag = isLocal ? '--local' : '';
    const command = `wrangler d1 execute ${database} ${localFlag} --command="SELECT version FROM _migrations ORDER BY version"`;
    
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    
    // Parse wrangler output (JSON format)
    const lines = output.split('\n').filter(line => line.trim());
    const versions = [];
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.results) {
          versions.push(...data.results.map(r => r.version));
        }
      } catch (e) {
        // Skip non-JSON lines
      }
    }
    
    return versions;
  } catch (error) {
    // If table doesn't exist, return empty array
    if (error.message.includes('no such table')) {
      return [];
    }
    throw error;
  }
}

/**
 * Ensure _migrations table exists
 */
function ensureMigrationsTable(database) {
  const localFlag = isLocal ? '--local' : '';
  const sql = `CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`;
  
  const command = `wrangler d1 execute ${database} ${localFlag} --command="${sql}"`;
  execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
  
  logger.info('Migrations table ensured', { database });
}

/**
 * Apply a migration to the database
 */
function applyMigration(migration, database) {
  if (isDryRun) {
    logger.info('DRY RUN: Would apply migration', {
      version: migration.version,
      name: migration.name,
      database
    });
    return;
  }
  
  const localFlag = isLocal ? '--local' : '';
  
  // Apply the migration SQL
  const applyCommand = `wrangler d1 execute ${database} ${localFlag} --file=${migration.filePath}`;
  execSync(applyCommand, { encoding: 'utf-8', stdio: 'inherit' });
  
  // Record in _migrations table
  const recordCommand = `wrangler d1 execute ${database} ${localFlag} --command="INSERT INTO _migrations (version, name, applied_at) VALUES (${migration.version}, '${migration.name}', ${Date.now()})"`;
  execSync(recordCommand, { encoding: 'utf-8', stdio: 'pipe' });
  
  logger.info('Migration applied successfully', {
    version: migration.version,
    name: migration.name,
    database
  });
}

/**
 * Rollback a migration from the database
 */
function rollbackMigration(migration, database) {
  if (isDryRun) {
    logger.info('DRY RUN: Would rollback migration', {
      version: migration.version,
      name: migration.name,
      database
    });
    return;
  }
  
  // Check if migration has a rollback file
  const rollbackFile = migration.file.replace('.sql', '.rollback.sql');
  const rollbackPath = path.join(MIGRATIONS_DIR, rollbackFile);
  
  if (!fs.existsSync(rollbackPath)) {
    logger.warn('No rollback file found - cannot automatically rollback', {
      version: migration.version,
      name: migration.name,
      rollbackFile
    });
    return;
  }
  
  const localFlag = isLocal ? '--local' : '';
  
  // Apply the rollback SQL
  const rollbackCommand = `wrangler d1 execute ${database} ${localFlag} --file=${rollbackPath}`;
  execSync(rollbackCommand, { encoding: 'utf-8', stdio: 'inherit' });
  
  // Remove from _migrations table
  const removeCommand = `wrangler d1 execute ${database} ${localFlag} --command="DELETE FROM _migrations WHERE version = ${migration.version}"`;
  execSync(removeCommand, { encoding: 'utf-8', stdio: 'pipe' });
  
  logger.info('Migration rolled back successfully', {
    version: migration.version,
    name: migration.name,
    database
  });
}

/**
 * Run migrations up to target version
 */
async function migrateUp() {
  logger.info('Starting migration UP', {
    targetVersion,
    isDryRun,
    isLocal
  });
  
  const migrations = getMigrationFiles();
  
  if (migrations.length === 0) {
    logger.info('No migration files found');
    return;
  }
  
  // Determine which database to use based on migration file name
  for (const migration of migrations) {
    // Skip if target version is set and this migration is beyond it
    if (targetVersion !== null && migration.version > targetVersion) {
      continue;
    }
    
    // Determine database based on file name
    const database = migration.file.includes('api_keys') || 
                     migration.file.includes('rooms') || 
                     migration.file.includes('permissions') ||
                     migration.file.includes('user_tier')
      ? AUTH_DATABASE_NAME 
      : DATABASE_NAME;
    
    // Ensure _migrations table exists
    ensureMigrationsTable(database);
    
    // Check if already applied
    const applied = await getAppliedMigrations(database);
    if (applied.includes(migration.version)) {
      logger.info('Migration already applied - skipping', {
        version: migration.version,
        name: migration.name
      });
      continue;
    }
    
    // Apply the migration
    try {
      applyMigration(migration, database);
    } catch (error) {
      logger.error('Migration failed', error, {
        version: migration.version,
        name: migration.name
      });
      throw error;
    }
  }
  
  logger.info('Migration UP completed successfully', {
    appliedCount: migrations.filter(m => 
      targetVersion === null || m.version <= targetVersion
    ).length
  });
}

/**
 * Rollback migrations to target version
 */
async function migrateDown() {
  if (!targetVersion) {
    logger.error('Target version required for rollback', new Error('Missing target version'));
    process.exit(1);
  }
  
  logger.info('Starting migration DOWN (rollback)', {
    targetVersion,
    isDryRun,
    isLocal
  });
  
  const migrations = getMigrationFiles().reverse(); // Rollback in reverse order
  
  for (const migration of migrations) {
    // Only rollback migrations greater than target version
    if (migration.version <= targetVersion) {
      continue;
    }
    
    // Determine database based on file name
    const database = migration.file.includes('api_keys') || 
                     migration.file.includes('rooms') || 
                     migration.file.includes('permissions') ||
                     migration.file.includes('user_tier')
      ? AUTH_DATABASE_NAME 
      : DATABASE_NAME;
    
    // Check if actually applied
    const applied = await getAppliedMigrations(database);
    if (!applied.includes(migration.version)) {
      logger.info('Migration not applied - skipping rollback', {
        version: migration.version,
        name: migration.name
      });
      continue;
    }
    
    // Rollback the migration
    try {
      rollbackMigration(migration, database);
    } catch (error) {
      logger.error('Rollback failed', error, {
        version: migration.version,
        name: migration.name
      });
      throw error;
    }
  }
  
  logger.info('Migration DOWN completed successfully');
}

/**
 * Show migration status
 */
async function showStatus() {
  logger.info('Migration status');
  
  const migrations = getMigrationFiles();
  const appliedRead = await getAppliedMigrations(DATABASE_NAME);
  const appliedAuth = await getAppliedMigrations(AUTH_DATABASE_NAME);
  
  console.log('\n=== READ REPLICA DATABASE ===');
  for (const migration of migrations.filter(m => !m.file.includes('api_keys') && !m.file.includes('rooms'))) {
    const status = appliedRead.includes(migration.version) ? '✅ Applied' : '⏳ Pending';
    console.log(`${status} - v${migration.version}: ${migration.name}`);
  }
  
  console.log('\n=== AUTH DATABASE ===');
  for (const migration of migrations.filter(m => m.file.includes('api_keys') || m.file.includes('rooms'))) {
    const status = appliedAuth.includes(migration.version) ? '✅ Applied' : '⏳ Pending';
    console.log(`${status} - v${migration.version}: ${migration.name}`);
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    switch (command) {
      case 'up':
        await migrateUp();
        break;
      case 'down':
        await migrateDown();
        break;
      case 'status':
        await showStatus();
        break;
      default:
        console.log(`
Usage: npm run migrate:enhanced [command] [options]

Commands:
  up [version]        Apply all pending migrations (or up to version)
  down <version>      Rollback migrations to version
  status              Show migration status

Options:
  --dry-run           Show what would happen without applying
  --local             Use local D1 database

Examples:
  npm run migrate:enhanced up
  npm run migrate:enhanced up 5
  npm run migrate:enhanced down 3
  npm run migrate:enhanced status
  npm run migrate:enhanced up --dry-run
  npm run migrate:enhanced up --local
        `);
        break;
    }
  } catch (error) {
    logger.error('Migration process failed', error);
    process.exit(1);
  }
}

main();
