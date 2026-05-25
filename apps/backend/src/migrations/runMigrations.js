const sql = require('mssql');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
console.log('Loaded .env file:', process.env);

const config = {
  user: 'sa',
  password: 'sherpa$05',
  server: 'INCH-VITFS01',
  port: 1433,
  database: 'DBA_Monitoring',
  options: {
    encrypt: false, // Set to true if using Azure
    trustServerCertificate: true,
  },
};

console.log('Database Configuration:', config);

async function runMigrations() {
  try {
    await sql.connect(config);
    console.log('Connected to SQL Server');
    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
    for (const file of files) {
      const query = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`Running migration: ${file}`);
      await sql.query(query);
    }
    console.log('All migrations executed successfully');
    await sql.close();
  } catch (err) {
    console.error('Migration error:', err);
    await sql.close();
    process.exit(1);
  }
}

runMigrations();