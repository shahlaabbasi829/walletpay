const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token' });
  }
};

// ====================== AUTH ROUTES ======================

// Register User
app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, balance',
      [name, email, hashedPassword]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login User
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, balance: user.balance } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====================== WALLET ROUTES ======================

// Get Balance + User Info
app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, balance FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Deposit Money
app.post('/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, description } = req.body;
    const userId = req.user.id;

    await pool.query('BEGIN');

    const update = await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
      [amount, userId]
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
      [userId, 'deposit', amount, description || 'Deposit']
    );

    await pool.query('COMMIT');
    res.json({ balance: update.rows[0].balance, message: 'Deposit successful' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Withdraw Money
app.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, description } = req.body;
    const userId = req.user.id;

    const balanceCheck = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
    if (balanceCheck.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await pool.query('BEGIN');

    const update = await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance',
      [amount, userId]
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
      [userId, 'withdraw', amount, description || 'Withdrawal']
    );

    await pool.query('COMMIT');
    res.json({ balance: update.rows[0].balance, message: 'Withdrawal successful' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  }
});

// Send Money (Transfer)
app.post('/transfer', authenticateToken, async (req, res) => {
  try {
    const { to_email, amount, description } = req.body;
    const fromId = req.user.id;

    const toUser = await pool.query('SELECT id FROM users WHERE email = $1', [to_email]);
    if (toUser.rows.length === 0) return res.status(404).json({ error: 'Recipient not found' });

    const toId = toUser.rows[0].id;
    if (fromId === toId) return res.status(400).json({ error: 'Cannot send to yourself' });

    const balanceCheck = await pool.query('SELECT balance FROM users WHERE id = $1', [fromId]);
    if (balanceCheck.rows[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await pool.query('BEGIN');

    // Deduct from sender
    await pool.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, fromId]);

    // Add to receiver
    await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, toId]);

    // Record transaction
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description, to_user_id) VALUES ($1, $2, $3, $4, $5)',
      [fromId, 'transfer', amount, description || `Sent to ${to_email}`, toId]
    );

    await pool.query('COMMIT');
    res.json({ message: 'Transfer successful' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// Get Transaction History
app.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.name as to_name 
       FROM transactions t 
       LEFT JOIN users u ON t.to_user_id = u.id 
       WHERE t.user_id = $1 
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 WalletPay Server running on http://localhost:${PORT}`);
});