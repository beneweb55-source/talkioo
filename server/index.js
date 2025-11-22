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
const PORT = process.env.PORT || 3001; // Backend Port
const JWT_SECRET = 'super_secret_key_change_this_in_prod';

// Use the connection string you provided
const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_XPSO1Fe6aqZk@ep-misty-queen-agi42tnv-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- DB INIT ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                tag VARCHAR(4) NOT NULL,
                is_online BOOLEAN DEFAULT FALSE,
                socket_id TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                name VARCHAR(100),
                is_group BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS participants (
                user_id UUID REFERENCES users(id),
                conversation_id UUID REFERENCES conversations(id),
                joined_at TIMESTAMP DEFAULT NOW(),
                last_deleted_at TIMESTAMP,
                PRIMARY KEY (user_id, conversation_id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                conversation_id UUID REFERENCES conversations(id),
                sender_id UUID REFERENCES users(id),
                content TEXT NOT NULL,
                replied_to_message_id UUID REFERENCES messages(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP,
                deleted_at TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS friend_requests (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                sender_id UUID REFERENCES users(id),
                receiver_id UUID REFERENCES users(id),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS message_reads (
                message_id UUID REFERENCES messages(id),
                user_id UUID REFERENCES users(id),
                read_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (message_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS groups (
                id UUID PRIMARY KEY REFERENCES conversations(id),
                name VARCHAR(100),
                created_by_user_id UUID REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS group_members (
                group_id UUID REFERENCES groups(id),
                user_id UUID REFERENCES users(id),
                role VARCHAR(20) DEFAULT 'member', -- owner, admin, member
                joined_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (group_id, user_id)
            );
        `);
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Error initializing database:", err);
    }
};

// --- MIDDLEWARE ---
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
})); 
app.use(express.json());

// Explicitly handle OPTIONS for all routes to prevent preflight 404s
app.options('*', cors());

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Token manquant" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Token invalide" });
        req.user = user;
        next();
    });
};

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId;
    
    if (userId) {
        try {
            await pool.query(
                'UPDATE users SET is_online = TRUE, socket_id = $1 WHERE id = $2',
                [socket.id, userId]
            );
            io.emit('USER_STATUS_UPDATE', { userId: userId, isOnline: true }); 
            socket.join(`user:${userId}`);
        } catch (err) {
            console.error("Socket Auth Error:", err.message);
        }
    }

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
    });
    
    socket.on('typing_start', ({ conversationId }) => {
        if (!userId) return;
        socket.to(conversationId).emit('typing_update', { conversationId, userId: userId, isTyping: true });
    });
  
    socket.on('typing_stop', ({ conversationId }) => {
        if (!userId) return;
        socket.to(conversationId).emit('typing_update', { conversationId, userId: userId, isTyping: false });
    });

    socket.on('disconnect', async () => { 
        try {
            const userRes = await pool.query('SELECT id FROM users WHERE socket_id = $1', [socket.id]);
            const disconnectedUserId = userRes.rows[0]?.id;

            if (disconnectedUserId) {
                await pool.query(
                    'UPDATE users SET is_online = FALSE, socket_id = NULL WHERE id = $1',
                    [disconnectedUserId]
                );
                io.emit('USER_STATUS_UPDATE', { userId: disconnectedUserId, isOnline: false });
            }
        } catch (err) {
            console.error("Socket Disconnect Error:", err.message);
        }
    });
});

// --- API ROUTES ---

app.get('/', (req, res) => res.send("Talkio Backend is Running 🚀"));

// 1. AUTH & REGISTRATION
app.post('/api/auth/register', async (req, res) => {
    let { username, email, password } = req.body;
    email = email.toLowerCase().trim();
    username = username.trim();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tag = Math.floor(1000 + Math.random() * 9000).toString();
        
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, tag) VALUES ($1, $2, $3, $4) RETURNING id, username, tag, email, created_at',
            [username, email, hashedPassword, tag]
        );
        
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        
        res.json({ user, token });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: "Erreur inscription (Email déjà pris ?)" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Identifiants invalides" });
    email = email.toLowerCase().trim();

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1', 
            [email]
        );
        const user = result.rows[0];
        
        if (!user) return res.status(400).json({ error: "Identifiants invalides" });

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.status(400).json({ error: "Identifiants invalides" });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        delete user.password_hash;
        
        res.json({ user, token });
    } catch (err) {
        console.error("Login Server Error:", err);
        res.status(500).json({ error: "Erreur interne du serveur" });
    }
});

app.put('/api/users/profile', authenticateToken, async (req, res) => {
    const { username, email } = req.body;
    try {
        const result = await pool.query(
            'UPDATE users SET username = $1, email = $2 WHERE id = $3 RETURNING id, username, email, tag, created_at',
            [username, email, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        const user = userRes.rows[0];
        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) return res.status(400).json({ error: "Mot de passe actuel incorrect" });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. DATA ACCESS
app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id FROM users WHERE is_online = TRUE');
        res.json(result.rows.map(u => u.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contacts', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT u.id, u.username, u.tag, u.email, u.is_online
            FROM friend_requests fr
            JOIN users u ON (CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END) = u.id
            WHERE (fr.sender_id = $1 OR fr.receiver_id = $1) AND fr.status = 'accepted'
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erreur chargement contacts." });
    }
});

// 4. CONVERSATIONS
app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { name, participantIds } = req.body; 
    const userId = req.user.id;

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: "Participants requis." });
    }

    try {
        const is_group = participantIds.length > 1 || (name && name.length > 0);

        const convRes = await pool.query(
            'INSERT INTO conversations (name, is_group) VALUES ($1, $2) RETURNING id',
            [is_group ? name : null, is_group]
        );
        const conversationId = convRes.rows[0].id;

        if (is_group) {
            await pool.query(
                'INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, $2, $3)',
                [conversationId, name, userId]
            );
        }

        const allParticipants = [...new Set([...participantIds, userId])];
        
        for (const uid of allParticipants) {
            await pool.query(
                'INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2)',
                [uid, conversationId]
            );
            if (is_group) {
                const role = (uid == userId) ? 'owner' : 'member';
                await pool.query(
                    'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
                    [conversationId, uid, role]
                );
            }
        }
        
        await pool.query(
             'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)',
             [conversationId, userId, is_group ? `👋 Groupe "${name}" créé !` : '👋 Nouvelle discussion.']
        );

        allParticipants.forEach(uid => {
            io.to(`user:${uid}`).emit('conversation_added', { conversationId });
        });

        res.status(201).json({ conversationId, name, is_group });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT c.*, 
                    p.last_deleted_at,
                    gm.role as my_role,
                    (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
                    (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
                    (SELECT deleted_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_deleted
            FROM conversations c
            JOIN participants p ON c.id = p.conversation_id
            LEFT JOIN group_members gm ON c.id = gm.group_id AND gm.user_id = $1
            WHERE p.user_id = $1
            ORDER BY last_message_time DESC NULLS LAST
        `;
        const result = await pool.query(query, [userId]);
        
        const enriched = result.rows.filter(row => {
            if (!row.last_message_time) return true;
            if (!row.last_deleted_at) return true;
            return new Date(row.last_message_time) > new Date(row.last_deleted_at);
        }).map(row => ({
            id: row.id,
            name: row.name,
            is_group: row.is_group,
            created_at: row.created_at,
            last_message: row.last_message_deleted ? "🚫 Message supprimé" : (row.last_message_content || "Nouvelle discussion"),
            last_message_at: row.last_message_time || row.created_at,
            my_role: row.my_role
        }));

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/conversations/:id', authenticateToken, async (req, res) => {
    const { name } = req.body;
    try {
        await pool.query('UPDATE conversations SET name = $1 WHERE id = $2', [name, req.params.id]);
        await pool.query('UPDATE groups SET name = $1 WHERE id = $2', [name, req.params.id]);
        
        io.to(req.params.id).emit('group_updated', { conversationId: req.params.id });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

app.post('/api/conversations/:id/read', authenticateToken, async (req, res) => {
    const conversationId = req.params.id;
    const userId = req.user.id;
    try {
        const messagesToReadRes = await pool.query(`
            SELECT m.id FROM messages m
            LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = $1
            WHERE m.conversation_id = $2 AND m.sender_id != $1 AND mr.message_id IS NULL
        `, [userId, conversationId]);

        const messageIds = messagesToReadRes.rows.map(row => row.id);

        if (messageIds.length > 0) {
            const readValues = [];
            const readPlaceholders = [];
            for (let i = 0; i < messageIds.length; i++) {
                readPlaceholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
                readValues.push(messageIds[i], userId);
            }
            await pool.query(
                `INSERT INTO message_reads (message_id, user_id) VALUES ${readPlaceholders.join(', ')} ON CONFLICT (message_id, user_id) DO NOTHING`, 
                readValues
            );
            io.to(conversationId).emit('READ_RECEIPT_UPDATE', { conversationId: conversationId, readerId: userId });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/conversations/:id/other', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.email, u.is_online
            FROM participants p JOIN users u ON p.user_id = u.id 
            WHERE p.conversation_id = $1 AND p.user_id != $2 LIMIT 1
        `, [req.params.id, req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/conversations/:id/members', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT gm.*, u.username, u.tag, u.is_online, p.joined_at
            FROM group_members gm
            JOIN users u ON gm.user_id = u.id
            JOIN participants p ON p.conversation_id = gm.group_id AND p.user_id = gm.user_id
            WHERE gm.group_id = $1
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/conversations/:id/members', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    const conversationId = req.params.id;
    try {
        await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, conversationId]);
        await pool.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [conversationId, userId, 'member']);
        
        io.to(conversationId).emit('group_updated', { conversationId });
        io.to(`user:${userId}`).emit('conversation_added', { conversationId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/conversations/:id/members/:userId', authenticateToken, async (req, res) => {
    const { id, userId } = req.params;
    try {
        await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, userId]);
        await pool.query('DELETE FROM participants WHERE conversation_id = $1 AND user_id = $2', [id, userId]);
        
        io.to(id).emit('group_updated', { conversationId: id });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/conversations/:id/members/:userId', authenticateToken, async (req, res) => {
    const { role } = req.body;
    try {
        await pool.query('UPDATE group_members SET role = $1 WHERE group_id = $2 AND user_id = $3', [role, req.params.id, req.params.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. MESSAGES
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, u.username, u.tag,
                (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id != $2) AS read_count,
                m2.content AS replied_to_content, u2.username AS replied_to_username, u2.tag AS replied_to_tag
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            LEFT JOIN messages m2 ON m.replied_to_message_id = m2.id
            LEFT JOIN users u2 ON m2.sender_id = u2.id
            WHERE m.conversation_id = $1 ORDER BY m.created_at ASC
        `, [req.params.id, req.user.id]);
        
        const messages = result.rows.map(m => ({
            ...m,
            sender_username: m.username ? `${m.username}#${m.tag}` : 'Inconnu',
            read_count: parseInt(m.read_count),
            reply: m.replied_to_message_id ? {
                id: m.replied_to_message_id,
                content: m.replied_to_content || 'Message original supprimé', 
                sender: m.replied_to_username ? `${m.replied_to_username}#${m.replied_to_tag}` : 'Inconnu'
            } : null
        }));
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    const { conversation_id, content, replied_to_message_id } = req.body;
    const senderId = req.user.id; 
    try {
        const result = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, content, replied_to_message_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [conversation_id, senderId, content, replied_to_message_id || null] 
        );
        const msg = result.rows[0];
        await pool.query('INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [msg.id, senderId]);
        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [senderId]);
        const sender = userRes.rows[0];
        
        let replyData = null;
        if (msg.replied_to_message_id) {
             const replyRes = await pool.query(`
                    SELECT m2.content, u2.username, u2.tag FROM messages m2 LEFT JOIN users u2 ON m2.sender_id = u2.id WHERE m2.id = $1
                `, [msg.replied_to_message_id]);
            const r = replyRes.rows[0];
            if (r) replyData = { id: msg.replied_to_message_id, content: r.content || 'Supprimé', sender: r.username ? `${r.username}#${r.tag}` : 'Inconnu' };
        }

        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}`, read_count: 0, reply: replyData }; 
        io.to(conversation_id).emit('new_message', fullMsg);
        
        const parts = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversation_id]);
        parts.rows.forEach(row => {
            io.to(`user:${row.user_id}`).emit('conversation_updated', { conversationId: conversation_id });
        });
        res.json(fullMsg);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/messages/:id', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const result = await pool.query('UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [content, req.params.id]);
        const msg = result.rows[0];
        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [msg.sender_id]);
        const readCountRes = await pool.query('SELECT COUNT(*) FROM message_reads WHERE message_id = $1 AND user_id != $2', [msg.id, req.user.id]);
        
        const fullMsg = { ...msg, sender_username: `${userRes.rows[0].username}#${userRes.rows[0].tag}`, read_count: parseInt(readCountRes.rows[0].count) };
        io.to(msg.conversation_id).emit('message_update', fullMsg);
        res.json(fullMsg);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = $1 RETURNING *', [req.params.id]);
        const msg = result.rows[0];
        io.to(msg.conversation_id).emit('message_update', { ...msg, content: "🚫 Message supprimé", deleted_at: msg.deleted_at });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. REQUESTS
app.post('/api/friend_requests', authenticateToken, async (req, res) => {
    const { targetIdentifier } = req.body;
    const lastHash = targetIdentifier?.lastIndexOf('#');
    if (!targetIdentifier || lastHash === -1) return res.status(400).json({ error: "Format Nom#1234 requis" });

    const username = targetIdentifier.substring(0, lastHash).trim();
    const tag = targetIdentifier.substring(lastHash + 1).trim();
    
    try {
        const userRes = await pool.query('SELECT id FROM users WHERE UPPER(username) = UPPER($1) AND tag = $2', [username, tag]);
        const target = userRes.rows[0];
        
        if (!target) return res.status(404).json({ error: "Utilisateur introuvable" });
        if (target.id === req.user.id) return res.status(400).json({ error: "Impossible" });

        const existing = await pool.query('SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [req.user.id, target.id]);
        if (existing.rows.find(r => r.status === 'pending')) return res.status(400).json({ error: "Déjà en attente" });
        if (existing.rows.find(r => r.status === 'accepted')) return res.status(400).json({ error: "Déjà amis" });

        const newReq = await pool.query('INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) RETURNING *', [req.user.id, target.id]);
        io.to(`user:${target.id}`).emit('friend_request', newReq.rows[0]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/friend_requests', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, u.username, u.tag, u.email FROM friend_requests r 
            JOIN users u ON r.sender_id = u.id WHERE r.receiver_id = $1 AND r.status = 'pending'
        `, [req.user.id]);
        const requests = result.rows.map(r => ({ id: r.id, status: r.status, sender: { id: r.sender_id, username: r.username, tag: r.tag } }));
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/friend_requests/:id/respond', authenticateToken, async (req, res) => {
    const { status } = req.body; 
    try {
        const result = await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
        const request = result.rows[0];
        
        if (status === 'accepted') {
            const convRes = await pool.query('INSERT INTO conversations (is_group) VALUES (false) RETURNING id');
            const convId = convRes.rows[0].id;
            await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2), ($3, $2)', [request.sender_id, convId, request.receiver_id]);
            await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [convId, request.receiver_id, '👋 Ami accepté !']);

            io.to(`user:${request.sender_id}`).emit('conversation_added', { conversationId: convId });
            io.to(`user:${request.receiver_id}`).emit('conversation_added', { conversationId: convId });
            res.json({ success: true, conversationId: convId });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. GENERIC USER ROUTES (Must be last of User routes to avoid collisions)
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        // Check for 'me' just in case request falls through
        const targetId = req.params.id === 'me' ? req.user.id : req.params.id;
        const result = await pool.query('SELECT id, username, tag, email, is_online FROM users WHERE id = $1', [targetId]);
        if (!result.rows[0]) return res.status(404).json({ error: "Utilisateur non trouvé" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 404 Handler (Catch-All for EVERYTHING, prevents HTML responses)
app.use('*', (req, res) => {
    console.log(`404 Hit: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API Endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Initialize
initDB().then(() => {
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});