const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.walletpay_db,
});

pool.connect()
  .then(() => console.log('✅ Connected to PostgreSQL - WalletPay'))
  .catch(err => console.error('❌ DB Connection Error:', err));

module.exports = pool;