import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config';
import { closePool, getPool } from './db';
import { hashPassword } from './auth';

async function migrate(): Promise<void> {
  const sqlPath = path.resolve(__dirname, '../sql/001_init.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  const pool = getPool();
  for (const statement of statements) {
    await pool.query(statement);
  }

  const passwordHash = await bcrypt.hash(config.adminInitialPassword, 12);
  await pool.execute(
    `INSERT IGNORE INTO admin_accounts (username, password_hash, status)
     VALUES (?, ?, 1)`,
    [config.adminInitialUsername, passwordHash]
  );

  console.log(`Database initialized. Default administrator: ${config.adminInitialUsername}`);
}

migrate()
  .catch((error) => {
    console.error('Database initialization failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
