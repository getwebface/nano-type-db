#!/usr/bin/env node
/**
 * Database Health Check and Auto-Fix Script
 * 
 * This script checks the health of your production databases and
 * automatically fixes common issues like missing tables.
 * 
 * Usage:
 *   node scripts/fix-database.js [--local|--remote]
 */

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const locationFlag = isLocal ? '--local' : '--remote';
const locationName = isLocal ? 'local' : 'remote';

console.log(`🔍 Checking database health (${locationName})...\n`);

/**
 * Execute a wrangler D1 command and return the output
 */
function execD1Command(database, command) {
  try {
    const fullCommand = `npx wrangler d1 execute ${database} ${locationFlag} --command="${command}"`;
    const output = execSync(fullCommand, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Execute a wrangler D1 file command
 */
function execD1File(database, filePath) {
  try {
    const fullCommand = `npx wrangler d1 execute ${database} ${locationFlag} --file=${filePath}`;
    const output = execSync(fullCommand, { encoding: 'utf-8', stdio: 'inherit' });
    return { success: true, output };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Check if a table exists in a database
 */
function tableExists(database, tableName) {
  // SECURITY: Validate table name to prevent SQL injection
  // This validation MUST occur before any SQL query using tableName
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    console.error(`Invalid table name: ${tableName}`);
    return false;
  }
  
  // SECURITY: tableName is validated above with regex - safe to interpolate
  // The regex validation on lines 51-56 ensures tableName can only contain
  // alphanumeric characters and underscores, preventing SQL injection
  const result = execD1Command(database, `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
  if (!result.success) {
    return false;
  }
  return result.output.includes(tableName);
}

/**
 * Get list of all tables in a database
 */
function getTables(database) {
  const result = execD1Command(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name");
  if (!result.success) {
    console.error(`❌ Failed to get tables from ${database}:`, result.error);
    return [];
  }
  
  // Parse the output to extract table names
  const tables = [];
  const lines = result.output.split('\n');
  for (const line of lines) {
    const match = line.match(/│\s+(\w+)\s+│/);
    if (match) {
      tables.push(match[1]);
    }
  }
  return tables;
}

// Check AUTH_DB
console.log('📊 Checking AUTH_DB (nanotype-auth)...');
const authTables = getTables('nanotype-auth');
console.log(`   Found tables: ${authTables.join(', ') || 'none'}`);

const requiredAuthTables = ['user', 'session', 'account', 'verification', 'api_keys', 'permissions'];
const missingAuthTables = requiredAuthTables.filter(t => !authTables.includes(t));

if (missingAuthTables.length > 0) {
  console.log(`   ⚠️  Missing tables: ${missingAuthTables.join(', ')}`);
  console.log('\n🔧 Attempting to fix by running auth_init.sql...');
  
  const result = execD1File('nanotype-auth', './auth_init.sql');
  if (result.success) {
    console.log('   ✅ Successfully initialized AUTH_DB');
  } else {
    console.error('   ❌ Failed to initialize AUTH_DB:', result.error);
  }
} else {
  console.log('   ✅ All required tables present');
}

// Check READ_REPLICA
console.log('\n📊 Checking READ_REPLICA (nanotype-read-replica)...');
const readTables = getTables('nanotype-read-replica');
console.log(`   Found tables: ${readTables.join(', ') || 'none'}`);

const requiredReadTables = ['tasks'];
const missingReadTables = requiredReadTables.filter(t => !readTables.includes(t));

if (missingReadTables.length > 0) {
  console.log(`   ⚠️  Missing tables: ${missingReadTables.join(', ')}`);
  console.log('\n🔧 Attempting to fix by running migration 0001...');
  
  const result = execD1File('nanotype-read-replica', './migrations/0001_read_replica_schema.sql');
  if (result.success) {
    console.log('   ✅ Successfully initialized READ_REPLICA');
  } else {
    console.error('   ❌ Failed to initialize READ_REPLICA:', result.error);
  }
} else {
  console.log('   ✅ All required tables present');
}

// Final check for API keys table specifically
console.log('\n🔑 Verifying API keys table...');
if (tableExists('nanotype-auth', 'api_keys')) {
  console.log('   ✅ API keys table exists and is accessible');
  
  // Test a simple query
  const testResult = execD1Command('nanotype-auth', 'SELECT COUNT(*) as count FROM api_keys');
  if (testResult.success) {
    console.log('   ✅ API keys table is queryable');
  } else {
    console.log('   ⚠️  API keys table exists but may have issues');
  }
} else {
  console.log('   ❌ API keys table is missing!');
  console.log('\n🔧 This is a critical issue. Running complete auth initialization...');
  
  const result = execD1File('nanotype-auth', './auth_init.sql');
  if (result.success) {
    console.log('   ✅ Auth database reinitialized');
    
    // Verify the fix
    if (tableExists('nanotype-auth', 'api_keys')) {
      console.log('   ✅ API keys table is now present');
    } else {
      console.log('   ❌ API keys table still missing after fix attempt');
    }
  } else {
    console.error('   ❌ Failed to fix API keys table:', result.error);
  }
}

console.log('\n✨ Database health check complete!');
console.log('\n📋 Next steps:');
console.log('   1. If issues were fixed, test your application');
console.log('   2. If issues persist, check PRODUCTION_MIGRATIONS_GUIDE.md');
console.log('   3. Run migrations: npm run migrate:enhanced up -- ' + locationFlag);
