const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- CONFIGURATION ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001; 
const JWT_SECRET = process.env.JWT_SECRET || 'talkio_super_secret_key_2024';

// --- BASE DE DONNÉES NEON ---
const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_XPSO1Fe6aqZk@ep-misty-queen-agi42tnv-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- MIDDLEWARE ---
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// --- ONLINE USERS TRACKING ---
const onlineUsers = new Set();

const notifyFriendsStatus = async (userId, isOnline) => {
    try {
        // Find friends (people in same conversations)
        const res = await pool.query(`
            SELECT DISTINCT p.user_id 
            FROM participants p
            JOIN participants me ON p.conversation_id = me.conversation_id
            WHERE me.user_id = $1 AND p.user_id != $1
        `, [userId]);
        
        res.rows.forEach(row => {
            io.to(`user:${row.user_id}`).emit('user_status', { userId, isOnline });
        });
    } catch (e) {
        console.error("Status notify error", e);
    }
};

// --- GESTION SOCKETS ---
io.on('connection', (socket) => {
  let currentUserId = null;

  const handleUserAuth = async (userId) => {
      if (currentUserId === userId) return; // Already auth
      currentUserId = userId;
      socket.userId = userId; // Attach to socket instance
      
      socket.join(`user:${userId}`);
      
      // Mark Online
      onlineUsers.add(userId);
      await notifyFriendsStatus(userId, true);
      console.log(`User ${userId} connected & online`);
  };

  // Auth via Handshake
  const token = socket.handshake.auth?.token;
  if (token) {
      try {
          const decoded = jwt.verify(token, JWT_SECRET);
          handleUserAuth(decoded.id);
      } catch (e) {
          console.error("Handshake auth failed", e.message);
      }
  }

  // Auth via Event
  socket.on('authenticate', (token) => {
      try {
          const decoded = jwt.verify(token, JWT_SECRET);
          handleUserAuth(decoded.id);
      } catch (e) {
          console.error("Socket event auth failed");
      }
  });

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
  });

  // Typing Indicators
  socket.on('typing_start', ({ conversationId }) => {
      if (!currentUserId) return;
      socket.to(conversationId).emit('typing_update', { conversationId, userId: currentUserId, isTyping: true });
  });

  socket.on('typing_stop', ({ conversationId }) => {
      if (!currentUserId) return;
      socket.to(conversationId).emit('typing_update', { conversationId, userId: currentUserId, isTyping: false });
  });

  socket.on('disconnect', async () => {
      if (currentUserId) {
          // Check if user has other sockets (tabs) open
          const sockets = await io.in(`user:${currentUserId}`).fetchSockets();
          if (sockets.length === 0) {
              onlineUsers.delete(currentUserId);
              await notifyFriendsStatus(currentUserId, false);
              console.log(`User ${currentUserId} offline`);
          }
      }
  });
});

// --- DATABASE INITIALIZATION ---
const initDB = async () => {
    let client;
    try {
        console.log("🔄 Connecting to Database...");
        client = await pool.connect();
        console.log("✅ Connected. Checking Database Schema...");
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username VARCHAR(50) NOT NULL,
                tag VARCHAR(4) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(username, tag)
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(100),
                is_group BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS participants (
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_deleted_at TIMESTAMP,
                PRIMARY KEY (user_id, conversation_id)
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP,
                deleted_at TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS friend_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log("✅ Database Schema Synchronized.");
    } catch (err) {
        console.error("\n❌ FATAL ERROR: Database initialization failed.");
        console.error(err.message);
        process.exit(1);
    } finally {
        if (client) client.release();
    }
};

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const getUserInfo = async (userId) => {
    const res = await pool.query('SELECT id, username, tag FROM users WHERE id = $1', [userId]);
    return res.rows[0];
};

// --- ROUTES ---

app.get('/', (req, res) => res.send("Talkio Backend is Running 🚀"));

// === IMPORTANT: ROUTES ORDER MATTERS ===
// Specific routes MUST be defined before wildcard routes like /:id

// 0. SYSTEM & SPECIFIC USER ROUTES
app.get('/api/users/online', authenticateToken, (req, res) => {
    res.json(Array.from(onlineUsers));
});

app.get('/api/contacts', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT u.id, u.username, u.tag 
            FROM participants p1
            JOIN conversations c ON p1.conversation_id = c.id
            JOIN participants p2 ON c.id = p2.conversation_id
            JOIN users u ON p2.user_id = u.id
            WHERE p1.user_id = $1 
              AND c.is_group = FALSE
              AND p2.user_id != $1
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1. AUTH & USER MANAGEMENT
app.post('/api/auth/register', async (req, res) => {
    let { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({error: "Champs manquants"});
    
    email = email.toLowerCase().trim();
    username = username.trim();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        let user = null;
        let attempts = 0;
        const MAX_ATTEMPTS = 5;

        while(attempts < MAX_ATTEMPTS) {
            const tag = Math.floor(1000 + Math.random() * 9000).toString();
            try {
                 const result = await pool.query(
                    'INSERT INTO users (username, email, password_hash, tag) VALUES ($1, $2, $3, $4) RETURNING id, username, tag, email, created_at',
                    [username, email, hashedPassword, tag]
                );
                user = result.rows[0];
                break;
            } catch (insertErr) {
                 if (insertErr.code === '23505') {
                     const detail = insertErr.detail || '';
                     if (detail.includes('tag')) {
                         attempts++;
                         continue;
                     }
                     throw new Error("EMAIL_EXISTS");
                 } else {
                     throw insertErr;
                 }
            }
        }

        if (!user) throw new Error("TAG_RETRY_LIMIT");
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        res.json({ user, token });
    } catch (err) {
        console.error("Register Error:", err);
        if (err.message === 'EMAIL_EXISTS') return res.status(400).json({ error: "Cet email est déjà utilisé." });
        if (err.message === 'TAG_RETRY_LIMIT') return res.status(400).json({ error: "Serveur saturé, réessayez." });
        res.status(500).json({ error: "Erreur serveur" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    let { email, password } = req.body;
    email = email.toLowerCase().trim();

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(400).json({ error: "Identifiants incorrects" });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        delete user.password_hash;
        res.json({ user, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Wildcard User Route (Must be AFTER specific /users/... routes)
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const user = await getUserInfo(req.params.id);
        if(!user) return res.status(404).json({error: "User not found"});
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. CONVERSATIONS

app.get('/api/conversations', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT c.*, p.last_deleted_at
            FROM conversations c
            JOIN participants p ON c.id = p.conversation_id
            WHERE p.user_id = $1
        `;
        const { rows: conversations } = await pool.query(query, [userId]);
        
        const enriched = await Promise.all(conversations.map(async (conv) => {
            const msgRes = await pool.query(`
                SELECT content, created_at, deleted_at 
                FROM messages 
                WHERE conversation_id = $1 
                ORDER BY created_at DESC LIMIT 1
            `, [conv.id]);
            
            const lastMsg = msgRes.rows[0];
            
            if (conv.last_deleted_at && lastMsg && new Date(conv.last_deleted_at) > new Date(lastMsg.created_at)) {
                return null; 
            }
            if (!lastMsg && conv.last_deleted_at) return null;

            return {
                id: conv.id,
                name: conv.name,
                is_group: conv.is_group,
                created_at: conv.created_at,
                last_message: lastMsg ? (lastMsg.deleted_at ? "🚫 Message supprimé" : lastMsg.content) : "Nouvelle discussion",
                last_message_at: lastMsg ? lastMsg.created_at : conv.created_at
            };
        }));

        const validConvs = enriched.filter(Boolean).sort((a, b) => 
            new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
        );

        res.json(validConvs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { name, participantIds } = req.body;
    if (!name || !participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: "Nom et participants requis" });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const convRes = await client.query('INSERT INTO conversations (name, is_group) VALUES ($1, true) RETURNING id', [name]);
        const convId = convRes.rows[0].id;

        const allUserIds = [...new Set([...participantIds, req.user.id])];

        for (const uid of allUserIds) {
            await client.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2)', [uid, convId]);
        }

        await client.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [convId, req.user.id, `📢 Groupe "${name}" créé`]);

        await client.query('COMMIT');

        // Notify all participants immediately
        allUserIds.forEach(uid => {
            io.to(`user:${uid}`).emit('conversation_added', { conversationId: convId });
        });

        res.json({ success: true, conversationId: convId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Create Group Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'UPDATE participants SET last_deleted_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/conversations/:id/other', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.email 
            FROM participants p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.conversation_id = $1 AND p.user_id != $2
            LIMIT 1
        `, [req.params.id, req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. MESSAGES
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, u.username, u.tag 
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `, [req.params.id]);
        
        const messages = result.rows.map(m => ({
            ...m,
            sender_username: m.username ? `${m.username}#${m.tag}` : 'Inconnu'
        }));
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    const { conversation_id, content } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
            [conversation_id, req.user.id, content]
        );
        const msg = result.rows[0];

        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        const sender = await getUserInfo(req.user.id);
        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}` };

        // Emit to the chat room (for open windows)
        io.to(conversation_id).emit('new_message', fullMsg);
        
        // Emit to ALL participants' user rooms (for list updates)
        const parts = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversation_id]);
        parts.rows.forEach(row => {
            io.to(`user:${row.user_id}`).emit('conversation_updated', { conversationId: conversation_id });
        });
        
        res.json(fullMsg);
    } catch (err) {
        console.error("Send Message Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/messages/:id', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const check = await pool.query('SELECT sender_id, conversation_id FROM messages WHERE id = $1', [req.params.id]);
        if (check.rows.length === 0) return res.status(404).json({error: "Not found"});
        if (check.rows[0].sender_id !== req.user.id) return res.status(403).json({error: "Unauthorized"});

        const conversation_id = check.rows[0].conversation_id;

        const result = await pool.query(
            'UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [content, req.params.id]
        );
        const msg = result.rows[0];
        
        const sender = await getUserInfo(msg.sender_id);
        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}` };

        io.to(conversation_id).emit('message_update', fullMsg);
        res.json(fullMsg);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const check = await pool.query('SELECT sender_id, conversation_id FROM messages WHERE id = $1', [req.params.id]);
        if (check.rows.length === 0) return res.status(404).json({error: "Not found"});
        if (check.rows[0].sender_id !== req.user.id) return res.status(403).json({error: "Unauthorized"});

        const conversation_id = check.rows[0].conversation_id;

        const result = await pool.query(
            'UPDATE messages SET deleted_at = NOW() WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        const msg = result.rows[0];
        
        const sender = await getUserInfo(msg.sender_id);
        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}` };

        io.to(conversation_id).emit('message_update', fullMsg);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. FRIEND REQUESTS
app.post('/api/friend_requests', authenticateToken, async (req, res) => {
    const { targetIdentifier } = req.body; 
    if (!targetIdentifier || !targetIdentifier.includes('#')) return res.status(400).json({ error: "Format 'Nom#1234' requis" });

    const parts = targetIdentifier.split('#');
    const usernameTarget = parts[0].trim();
    const tagTarget = parts[1].trim();

    try {
        const userRes = await pool.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND tag = $2', 
            [usernameTarget, tagTarget]
        );
        const targetUser = userRes.rows[0];
        
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });
        if (targetUser.id === req.user.id) return res.status(400).json({ error: "Impossible de s'ajouter soi-même" });

        const existing = await pool.query(
            'SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)',
            [req.user.id, targetUser.id]
        );

        // Mutual Add Logic
        const reversePending = existing.rows.find(r => r.sender_id === targetUser.id && r.receiver_id === req.user.id && r.status === 'pending');

        if (reversePending) {
            await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2', ['accepted', reversePending.id]);
            const convRes = await pool.query('INSERT INTO conversations (is_group) VALUES (false) RETURNING id');
            const convId = convRes.rows[0].id;
            await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2), ($3, $2)', [req.user.id, convId, targetUser.id]);
            await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [convId, req.user.id, '👋 Ami accepté mutuellement !']);
            
            // Force Update for both users
            io.to(`user:${targetUser.id}`).emit('conversation_added', { conversationId: convId });
            io.to(`user:${req.user.id}`).emit('conversation_added', { conversationId: convId });

            return res.json({ success: true, message: "Vous êtes désormais amis !", conversationId: convId });
        }

        const areFriends = existing.rows.some(r => r.status === 'accepted');
        if (areFriends) return res.status(400).json({ error: "Vous êtes déjà amis !" });

        const isPending = existing.rows.some(r => r.status === 'pending');
        if (isPending) return res.status(400).json({ error: "Demande déjà en cours" });

        const newReq = await pool.query(
            'INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) RETURNING *',
            [req.user.id, targetUser.id]
        );

        io.to(`user:${targetUser.id}`).emit('friend_request', newReq.rows[0]);
        res.json({ success: true });

    } catch (err) {
        console.error("Friend Req Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/friend_requests', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, u.username, u.tag, u.email 
            FROM friend_requests r 
            JOIN users u ON r.sender_id = u.id 
            WHERE r.receiver_id = $1 AND r.status = 'pending'
        `, [req.user.id]);
        
        const requests = result.rows.map(r => ({
            id: r.id,
            sender_id: r.sender_id,
            receiver_id: r.receiver_id,
            status: r.status,
            created_at: r.created_at,
            sender: { id: r.sender_id, username: r.username, tag: r.tag, email: r.email }
        }));
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/friend_requests/:id/respond', authenticateToken, async (req, res) => {
    const { status } = req.body; 
    try {
        const result = await pool.query(
            'UPDATE friend_requests SET status = $1 WHERE id = $2 RETURNING *',
            [status, req.params.id]
        );
        
        if (result.rows.length === 0) return res.status(404).json({error: "Demande introuvable"});

        const request = result.rows[0];
        
        if (status === 'accepted') {
            const convRes = await pool.query('INSERT INTO conversations (is_group) VALUES (false) RETURNING id');
            const convId = convRes.rows[0].id;
            
            await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2), ($3, $2)', [request.sender_id, convId, request.receiver_id]);
            await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [convId, request.receiver_id, '👋 Ami accepté !']);

            // Notify both (Sender via Socket, Receiver via Response)
            io.to(`user:${request.sender_id}`).emit('conversation_added', { conversationId: convId });
            // Optional redundancy for current user
            io.to(`user:${request.receiver_id}`).emit('conversation_added', { conversationId: convId });

            res.json({ success: true, conversationId: convId });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        console.error("Respond Req Error:", err);
        res.status(500).json({ error: err.message });
    }
});

initDB().then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
});