const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto'); // Built-in Node module

// --- CONFIGURATION ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'super_secret_key_change_this_in_prod';

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dz8b5k9wp',
  api_key: process.env.CLOUDINARY_API_KEY || '338861446288879',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'F0OXEL6772gWT1hqzDnWCZj1wGg' 
});

// Configuration Multer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_XPSO1Fe6aqZk@ep-misty-queen-agi42tnv-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
});

// --- DB INITIALIZATION ---
const initDB = async () => {
    try {
        console.log("Initializing Database...");

        // 1. Enable UUID extension (Good to have, but we will make blocked_users resilient without it)
        try {
            await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        } catch (e) {
            console.warn("Could not create extension pgcrypto (might require superuser):", e.message);
        }

        // 2. Create Users Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                tag TEXT NOT NULL,
                avatar_url TEXT,
                is_online BOOLEAN DEFAULT FALSE,
                socket_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // 3. Create Conversations & Participants
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                name TEXT,
                is_group BOOLEAN DEFAULT FALSE,
                avatar_url TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS participants (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT DEFAULT 'member',
                joined_at TIMESTAMPTZ DEFAULT NOW(),
                last_deleted_at TIMESTAMPTZ,
                UNIQUE(user_id, conversation_id)
            );
        `);

        // 4. Create Messages & Helpers
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
                content TEXT,
                message_type TEXT DEFAULT 'text',
                attachment_url TEXT,
                replied_to_message_id UUID REFERENCES messages(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ,
                deleted_at TIMESTAMPTZ
            );
            CREATE TABLE IF NOT EXISTS friend_requests (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 5. Create Blocked Users (Robust definition - no DEFAULT UUID)
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS blocked_users (
                    id UUID PRIMARY KEY,
                    blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(blocker_id, blocked_id)
                )
            `);
            // Index manually just in case
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_blocked_blocker ON blocked_users(blocker_id)`);
        } catch (e) {
            console.error("Error creating blocked_users table:", e.message);
        }

        // 6. Create Stickers & Reactions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stickers (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                url TEXT NOT NULL,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS message_reads (
                message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                read_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (message_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS message_reactions (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                emoji TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(message_id, user_id, emoji)
            );
        `);
        
        // Add columns if they don't exist (migrations)
        await pool.query(`
            ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_deleted_at TIMESTAMPTZ;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS replied_to_message_id UUID REFERENCES messages(id);
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        `);

        // Insert default stickers if table is empty
        const stickersCheck = await pool.query('SELECT count(*) FROM stickers');
        if (parseInt(stickersCheck.rows[0].count) === 0) {
             await pool.query(`
                INSERT INTO stickers (url, user_id) VALUES 
                ('https://media.tenor.com/On7kB9wu8nQAAAAi/loading-hold-on.gif', NULL),
                ('https://media.tenor.com/2nAv7pCjS5kAAAAi/pepe-clap.gif', NULL),
                ('https://media.tenor.com/Si7KxV0ScIUAAAAi/cat-vibe.gif', NULL),
                ('https://media.tenor.com/TyM5JqgM8iAAAAAi/thumbs-up-okay.gif', NULL);
             `);
        }

        console.log("Database initialized successfully");
    } catch (err) {
        console.error("Error initializing database:", err);
    }
};

// Call initDB on startup
initDB();

// --- HELPER FUNCTIONS ---
const getAggregatedReactions = async (messageId) => {
    try {
        const res = await pool.query(`
            SELECT mr.emoji, mr.user_id, u.username 
            FROM message_reactions mr 
            JOIN users u ON mr.user_id = u.id
            WHERE mr.message_id = $1
        `, [messageId]);
        return res.rows;
    } catch (err) {
        console.error("Error aggregating reactions:", err);
        return [];
    }
};

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    // console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
})); 

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- SOCKET.IO ---
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000, 
    pingInterval: 25000
});

io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId;
    
    if (userId) {
        try {
            await pool.query('UPDATE users SET is_online = TRUE, socket_id = $1 WHERE id = $2', [socket.id, userId]);
            io.emit('USER_STATUS_UPDATE', { userId: userId, isOnline: true });
            socket.join(`user:${userId}`);
        } catch (err) { console.error("Erreur statut:", err.message); }
    }

    socket.on('join_room', (roomId) => socket.join(roomId));
    socket.on('join_user_channel', (userId) => socket.join(`user:${userId}`));

    socket.on('typing_start', ({ conversationId }) => {
        if (!userId) return;
        socket.to(conversationId).emit('typing_update', { conversationId, userId, isTyping: true });
    });
    socket.on('typing_stop', ({ conversationId }) => {
        if (!userId) return;
        socket.to(conversationId).emit('typing_update', { conversationId, userId, isTyping: false });
    });

    socket.on('disconnect', async () => { 
        try {
            const userRes = await pool.query('SELECT id FROM users WHERE socket_id = $1', [socket.id]);
            const disconnectedUserId = userRes.rows[0]?.id;
            if (disconnectedUserId) {
                await pool.query('UPDATE users SET is_online = FALSE, socket_id = NULL WHERE id = $1', [disconnectedUserId]);
                io.emit('USER_STATUS_UPDATE', { userId: disconnectedUserId, isOnline: false });
            }
        } catch (err) { console.error("Erreur déconnexion:", err.message); }
    });
});

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

// --- ROUTES ---

// GIFS (TENOR PROXY)
app.get('/api/gifs/search', async (req, res) => {
    const { q, pos } = req.query;
    const apiKey = process.env.TENOR_API_KEY;
    const clientKey = "talkio_app";
    const limit = 20;

    if (!apiKey) return res.status(500).json({ error: "Tenor API Key not configured" });

    try {
        let url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${apiKey}&client_key=${clientKey}&limit=${limit}&media_filter=minimal`;
        if (pos) url += `&pos=${pos}`;
        
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Tenor Search Error:", error);
        res.status(500).json({ error: "Failed to fetch GIFs" });
    }
});

app.get('/api/gifs/trending', async (req, res) => {
    const { pos } = req.query;
    const apiKey = process.env.TENOR_API_KEY;
    const clientKey = "talkio_app";
    const limit = 20;

    if (!apiKey) return res.status(500).json({ error: "Tenor API Key not configured" });

    try {
        let url = `https://tenor.googleapis.com/v2/featured?key=${apiKey}&client_key=${clientKey}&limit=${limit}&media_filter=minimal`;
        if (pos) url += `&pos=${pos}`;

        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
         console.error("Tenor Trending Error:", error);
         res.status(500).json({ error: "Failed to fetch GIFs" });
    }
});

// --- STICKERS ROUTES ---

app.get('/api/stickers', authenticateToken, async (req, res) => {
    try {
        // Fetch global stickers (user_id IS NULL) and user's own stickers
        const result = await pool.query(
            'SELECT * FROM stickers WHERE user_id IS NULL OR user_id = $1 ORDER BY created_at DESC', 
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stickers', authenticateToken, upload.single('sticker'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier" });
    
    try {
        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                { folder: `chat-app/stickers/${req.user.id}`, resource_type: "image" },
                (error, result) => { if (error) reject(error); else resolve(result); }
            );
            uploadStream.end(req.file.buffer);
        });

        const result = await pool.query(
            'INSERT INTO stickers (url, user_id) VALUES ($1, $2) RETURNING *',
            [uploadResult.secure_url, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: "Erreur upload sticker" }); }
});

// REACTIONS
app.post('/api/messages/:id/react', authenticateToken, async (req, res) => {
    const messageId = req.params.id;
    const userId = req.user.id;
    const { emoji } = req.body; 

    try {
        const msgCheck = await pool.query('SELECT conversation_id FROM messages WHERE id = $1', [messageId]);
        if (msgCheck.rows.length === 0) return res.status(404).json({ error: "Message introuvable" });
        const conversationId = msgCheck.rows[0].conversation_id;

        if (!emoji) return res.status(400).json({ error: "Emoji required" });
        
        const existing = await pool.query(
            'SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', 
            [messageId, userId, emoji]
        );
        
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM message_reactions WHERE id = $1', [existing.rows[0].id]);
        } else {
            await pool.query(
                'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', 
                [messageId, userId, emoji]
            );
        }

        const reactions = await getAggregatedReactions(messageId);
        
        io.to(conversationId).emit('message_reaction_update', { messageId, reactions });

        res.json({ success: true, reactions });
    } catch (err) { res.status(500).json({ error: "Erreur serveur réaction" }); }
});

app.get('/', (req, res) => res.send("Talkio Backend is Running 🚀"));

// AUTH
app.post('/api/auth/register', async (req, res) => {
    let { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tag = Math.floor(1000 + Math.random() * 9000).toString();
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, tag) VALUES ($1, $2, $3, $4) RETURNING id, username, tag, email, created_at, avatar_url',
            [username.trim(), email.toLowerCase().trim(), hashedPassword, tag]
        );
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        res.json({ user, token });
    } catch (err) { res.status(400).json({ error: "Erreur inscription (Email déjà pris ?)" }); }
});

app.post('/api/auth/login', async (req, res) => {
    let { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(400).json({ error: "Identifiants invalides" });
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        delete user.password_hash;
        res.json({ user, token });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// USERS & PROFILE
app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id FROM users WHERE is_online = TRUE');
        res.json(result.rows.map(u => u.id));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/profile', authenticateToken, upload.single('avatar'), async (req, res) => {
    const { username, email } = req.body;
    let avatarUrl = null;
    
    if (req.file) {
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: `chat-app/avatars`, resource_type: "image", transformation: [{ width: 300, height: 300, crop: "fill", gravity: "face" }] },
                    (error, result) => { if (error) reject(error); else resolve(result); }
                );
                uploadStream.end(req.file.buffer);
            });
            avatarUrl = uploadResult.secure_url;
        } catch (error) { return res.status(500).json({ error: "Erreur upload avatar" }); }
    }

    try {
        const result = await pool.query(
            'UPDATE users SET username = COALESCE($1, username), email = COALESCE($2, email), avatar_url = COALESCE($3, avatar_url) WHERE id = $4 RETURNING id, username, tag, email, created_at, avatar_url',
            [username, email, avatarUrl, req.user.id]
        );
        const updatedUser = result.rows[0];
        io.emit('USER_PROFILE_UPDATE', updatedUser);
        res.json(updatedUser);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
        const valid = await bcrypt.compare(oldPassword, userRes.rows[0].password_hash);
        if (!valid) return res.status(400).json({ error: "Ancien mot de passe incorrect" });
        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, tag, email, is_online, avatar_url FROM users WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- BLOCKING & FRIENDS ---

app.post('/api/users/block', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    if (!userId || userId === req.user.id) return res.status(400).json({ error: "Invalid User" });
    try {
        // Generate UUID in Javascript to bypass missing pgcrypto extension on database
        const id = crypto.randomUUID();
        await pool.query('INSERT INTO blocked_users (id, blocker_id, blocked_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, req.user.id, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/unblock', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    try {
        await pool.query('DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/blocked', authenticateToken, async (req, res) => {
    try {
        // Return real profile data so the user knows WHO they blocked.
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar_url 
            FROM blocked_users b 
            JOIN users u ON b.blocked_id = u.id 
            WHERE b.blocker_id = $1
        `, [req.user.id]);
        
        res.json(result.rows);
    } catch (err) { 
        console.error("Error fetching blocked users:", err);
        // If table doesn't exist yet, return empty array instead of crashing
        if (err.code === '42P01') {
            return res.json([]);
        }
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/friends/:friendId', authenticateToken, async (req, res) => {
    const friendId = req.params.friendId;
    const userId = req.user.id;
    try {
        // Delete friend request
        await pool.query(`
            DELETE FROM friend_requests 
            WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
        `, [userId, friendId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', authenticateToken, async (req, res) => {
    try {
        // DISTINCT ON (u.id) prevents duplicate contacts if multiple paths exist
        const query = `
            SELECT DISTINCT ON (u.id) u.id, u.username, u.tag, u.email, u.is_online, u.avatar_url, fr.status AS friend_status, c.id AS conversation_id
            FROM friend_requests fr
            JOIN users u ON (CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END) = u.id
            LEFT JOIN participants p1 ON p1.user_id = fr.sender_id AND p1.conversation_id IN (
                SELECT p2.conversation_id FROM participants p2 WHERE p2.user_id = fr.receiver_id
            )
            LEFT JOIN conversations c ON c.id = p1.conversation_id AND c.is_group = FALSE
            WHERE (fr.sender_id = $1 OR fr.receiver_id = $1) AND fr.status = 'accepted'
            ORDER BY u.id
        `;
        const result = await pool.query(query, [req.user.id]);
        
        // Ensure blocked_users table exists before querying
        let blockedIds = new Set();
        try {
            const blockedRes = await pool.query('SELECT blocked_id FROM blocked_users WHERE blocker_id = $1', [req.user.id]);
            blockedIds = new Set(blockedRes.rows.map(r => r.blocked_id));
        } catch (e) {
            // Ignore if table doesn't exist
        }
        
        const filtered = result.rows.filter(c => !blockedIds.has(c.id));
        
        res.json(filtered);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CONVERSATIONS & GROUPS ---

app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { name, participantIds } = req.body; 
    const userId = req.user.id;
    if (!participantIds || participantIds.length === 0) return res.status(400).json({ error: "Participants requis." });
    try {
        const is_group = participantIds.length > 1 || (name && name.length > 0);
        const convRes = await pool.query('INSERT INTO conversations (name, is_group) VALUES ($1, $2) RETURNING id', [is_group ? name : null, is_group]);
        const conversationId = convRes.rows[0].id;
        const allParticipants = [...new Set([...participantIds, userId])];
        
        let participantValues = [], participantPlaceholders = [];
        for (let i = 0; i < allParticipants.length; i++) {
            const uid = allParticipants[i];
            const role = (uid === userId && is_group) ? 'admin' : 'member';
            participantPlaceholders.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
            participantValues.push(uid, conversationId, role);
        }
        await pool.query(`INSERT INTO participants (user_id, conversation_id, role) VALUES ${participantPlaceholders.join(', ')}`, participantValues);
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [conversationId, userId, is_group ? `👋 Groupe "${name}" créé !` : '👋 Nouvelle discussion.']);
        
        allParticipants.forEach(uid => io.to(`user:${uid}`).emit('conversation_added', { conversationId }));
        res.status(201).json({ conversationId, name, is_group, participants: allParticipants });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Group Info (Name, Avatar)
app.put('/api/conversations/:id', authenticateToken, upload.single('avatar'), async (req, res) => {
    const conversationId = req.params.id;
    const { name } = req.body;
    let avatarUrl = null;

    if (req.file) {
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: `chat-app/groups`, resource_type: "image", transformation: [{ width: 300, height: 300, crop: "fill" }] },
                    (error, result) => { if (error) reject(error); else resolve(result); }
                );
                uploadStream.end(req.file.buffer);
            });
            avatarUrl = uploadResult.secure_url;
        } catch (error) { return res.status(500).json({ error: "Erreur upload avatar" }); }
    }

    try {
        const result = await pool.query(
            'UPDATE conversations SET name = COALESCE($1, name), avatar_url = COALESCE($2, avatar_url) WHERE id = $3 RETURNING *',
            [name, avatarUrl, conversationId]
        );
        const updatedConv = result.rows[0];
        
        // Notify all participants
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversationId]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_updated', { conversationId }));
        
        res.json(updatedConv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT c.*, p.last_deleted_at,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
                (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
                (SELECT deleted_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_deleted
            FROM conversations c
            JOIN participants p ON c.id = p.conversation_id
            WHERE p.user_id = $1
            ORDER BY last_message_time DESC NULLS LAST
        `;
        const result = await pool.query(query, [req.user.id]);
        
        // Need to check for blocks to anonymize list
        const blockedMap = new Set(); 
        try {
            const blocksRes = await pool.query('SELECT blocked_id, blocker_id FROM blocked_users WHERE blocker_id = $1 OR blocked_id = $1', [req.user.id]);
            blocksRes.rows.forEach(r => {
                 // If I blocked them or they blocked me
                 if (r.blocker_id === req.user.id) blockedMap.add(r.blocked_id);
                 if (r.blocked_id === req.user.id) blockedMap.add(r.blocker_id);
            });
        } catch (e) {
            // Ignore missing table
        }

        // Filter out deleted conversations
        const visibleConversations = result.rows.filter(row => {
            // If never deleted, keep it
            if (!row.last_deleted_at) return true;
            
            // If deleted, only keep if there is a message AFTER the deletion date
            if (!row.last_message_time) return false; 
            
            return new Date(row.last_message_time) > new Date(row.last_deleted_at);
        });

        const enriched = await Promise.all(visibleConversations.map(async (row) => {
            let displayName = row.name;
            let displayAvatar = row.avatar_url;

            if (!row.is_group) {
                const otherPRes = await pool.query(`
                    SELECT u.id, u.username, u.tag, u.avatar_url FROM participants p JOIN users u ON p.user_id = u.id 
                    WHERE p.conversation_id = $1 AND p.user_id != $2 ORDER BY (p.user_id = $2) ASC LIMIT 1
                `, [row.id, req.user.id]);
                
                if (otherPRes.rows.length > 0) {
                    const u = otherPRes.rows[0];
                    if (blockedMap.has(u.id)) {
                        displayName = "Utilisateur Evo";
                        displayAvatar = null;
                    } else {
                        displayName = `${u.username}#${u.tag}`;
                        displayAvatar = u.avatar_url;
                    }
                } else { displayName = "Discussion"; }
            }
            return {
                ...row,
                name: displayName || "Discussion",
                avatar_url: displayAvatar,
                last_message: row.last_message_deleted ? "🚫 Message supprimé" : (row.last_message_content || "Nouvelle discussion"),
                last_message_at: row.last_message_time || row.created_at
            };
        }));
        res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Soft delete / Hide conversation
app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE participants SET last_deleted_at = NOW() WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Destroy Group (Hard Delete for everyone)
app.delete('/api/conversations/:id/destroy', authenticateToken, async (req, res) => {
    const conversationId = req.params.id;
    try {
        // Verify admin rights
        const adminCheck = await pool.query('SELECT role FROM participants WHERE conversation_id = $1 AND user_id = $2', [conversationId, req.user.id]);
        if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: "Seuls les admins peuvent supprimer le groupe." });
        }

        // Notify participants before deletion
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversationId]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_removed', { conversationId }));

        // Delete (Cascade handles participants/messages usually, but doing manual just in case)
        await pool.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
        await pool.query('DELETE FROM participants WHERE conversation_id = $1', [conversationId]);
        await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Members of a Group
app.get('/api/conversations/:id/members', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar_url, p.role, p.joined_at
            FROM participants p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.conversation_id = $1
            ORDER BY p.role = 'admin' DESC, p.joined_at ASC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add Members to Group
app.post('/api/conversations/:id/members', authenticateToken, async (req, res) => {
    const { userIds } = req.body;
    const conversationId = req.params.id;
    try {
        const placeholders = userIds.map((uid, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
        const values = userIds.flatMap(uid => [uid, conversationId, 'member']);
        
        await pool.query(`INSERT INTO participants (user_id, conversation_id, role) VALUES ${placeholders} ON CONFLICT DO NOTHING`, values);
        
        userIds.forEach(uid => io.to(`user:${uid}`).emit('conversation_added', { conversationId }));
        
        // Notify Group
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [conversationId, req.user.id, `👋 Nouveaux membres ajoutés.`]);
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversationId]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_updated', { conversationId }));

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove Member (Kick)
app.delete('/api/conversations/:id/members/:userId', authenticateToken, async (req, res) => {
    const conversationId = req.params.id;
    const targetUserId = req.params.userId;
    try {
        // Verify requester is admin
        const adminCheck = await pool.query('SELECT role FROM participants WHERE conversation_id = $1 AND user_id = $2', [conversationId, req.user.id]);
        if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
            return res.status(403).json({ error: "Seuls les admins peuvent exclure des membres." });
        }

        await pool.query('DELETE FROM participants WHERE conversation_id = $1 AND user_id = $2', [conversationId, targetUserId]);
        
        // Notify
        io.to(`user:${targetUserId}`).emit('conversation_removed', { conversationId }); // Client logic to hide it?
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [conversationId, req.user.id, `🚫 Un membre a été exclu.`]);
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversationId]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_updated', { conversationId }));

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Leave Group
app.delete('/api/conversations/:id/leave', authenticateToken, async (req, res) => {
    const conversationId = req.params.id;
    try {
        await pool.query('DELETE FROM participants WHERE conversation_id = $1 AND user_id = $2', [conversationId, req.user.id]);
        
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [conversationId, req.user.id, `🏃 a quitté le groupe.`]);
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversationId]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_updated', { conversationId }));
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


app.post('/api/conversations/:id/read', authenticateToken, async (req, res) => {
    const conversationId = req.params.id;
    try {
        const messagesToReadRes = await pool.query(`
            SELECT m.id FROM messages m LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = $1
            WHERE m.conversation_id = $2 AND m.sender_id != $1 AND mr.message_id IS NULL
        `, [req.user.id, conversationId]);

        const messageIds = messagesToReadRes.rows.map(row => row.id);
        if (messageIds.length > 0) {
            const readValues = [], readPlaceholders = [];
            for (let i = 0; i < messageIds.length; i++) {
                readPlaceholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
                readValues.push(messageIds[i], req.user.id);
            }
            await pool.query(`INSERT INTO message_reads (message_id, user_id) VALUES ${readPlaceholders.join(', ')} ON CONFLICT DO NOTHING`, readValues);
            io.to(conversationId).emit('READ_RECEIPT_UPDATE', { conversationId, readerId: req.user.id });
        }
        res.json({ success: true, count: messageIds.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations/:id/other', authenticateToken, async (req, res) => {
    try {
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1 AND user_id != $2 LIMIT 1', [req.params.id, req.user.id]);
        if (pRes.rows.length === 0) return res.json(null);
        
        const otherId = pRes.rows[0].user_id;

        // Check Block Status
        let isBlockedByMe = false;
        let isBlockingMe = false;
        
        try {
            const blockRes = await pool.query(`
                SELECT blocker_id FROM blocked_users 
                WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
            `, [req.user.id, otherId]);

            isBlockedByMe = blockRes.rows.some(r => r.blocker_id === req.user.id);
            isBlockingMe = blockRes.rows.some(r => r.blocker_id === otherId);
        } catch(e) { /* ignore */ }
        
        // Fetch User Data
        const uRes = await pool.query('SELECT id, username, tag, email, is_online, avatar_url FROM users WHERE id = $1', [otherId]);
        let userData = uRes.rows[0];

        // Anonymize if blocked
        if (isBlockedByMe || isBlockingMe) {
            userData = {
                ...userData,
                username: 'Utilisateur Evo',
                tag: '????',
                avatar_url: null, 
                is_online: false 
            };
        }

        res.json({ 
            ...userData, 
            is_blocked_by_me: isBlockedByMe,
            is_blocking_me: isBlockingMe 
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                m.*, 
                u.username, u.tag, u.avatar_url AS sender_avatar,
                (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id != $2) AS read_count,
                m2.content AS replied_to_content, u2.username AS replied_to_username, u2.tag AS replied_to_tag,
                m2.message_type AS replied_to_type, m2.attachment_url AS replied_to_attachment_url,
                (
                    SELECT json_agg(json_build_object('emoji', mr.emoji, 'user_id', mr.user_id, 'username', u_react.username))
                    FROM message_reactions mr
                    JOIN users u_react ON mr.user_id = u_react.id
                    WHERE mr.message_id = m.id
                ) as reactions
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            LEFT JOIN messages m2 ON m.replied_to_message_id = m2.id
            LEFT JOIN users u2 ON m2.sender_id = u2.id
            WHERE m.conversation_id = $1 
            ORDER BY m.created_at ASC
        `, [req.params.id, req.user.id]);
        
        const messages = result.rows.map(m => ({
            ...m,
            sender_username: m.username ? `${m.username}#${m.tag}` : 'Inconnu',
            read_count: parseInt(m.read_count),
            reply: m.replied_to_message_id ? {
                id: m.replied_to_message_id,
                content: m.replied_to_content || 'Message supprimé',
                sender: m.replied_to_username ? `${m.replied_to_username}#${m.replied_to_tag}` : 'Inconnu',
                message_type: m.replied_to_type,
                attachment_url: m.replied_to_attachment_url
            } : null,
            reactions: m.reactions || []
        }));
        res.json(messages);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// MESSAGE SENDING & UPLOAD
const uploadMiddleware = upload.single('media');

app.post('/api/messages', authenticateToken, (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
        if (err) return res.status(500).json({ error: `Upload Error: ${err.message}` });
        next();
    });
}, async (req, res) => {
    const { conversation_id, replied_to_message_id } = req.body;
    const senderId = req.user.id;
    
    // Check if blocked OR not friend (for 1:1)
    const convCheck = await pool.query('SELECT is_group FROM conversations WHERE id = $1', [conversation_id]);
    if (!convCheck.rows[0]) return res.status(404).json({ error: "Conversation introuvable" });

    if (!convCheck.rows[0].is_group) {
        const otherP = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1 AND user_id != $2', [conversation_id, senderId]);
        if (otherP.rows.length > 0) {
            const otherId = otherP.rows[0].user_id;
            
            // Check Block
            let blocked = { rows: [] };
            try {
                blocked = await pool.query('SELECT 1 FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [senderId, otherId]);
            } catch(e) {/* ignore if table missing */}
            
            if (blocked.rows.length > 0) return res.status(403).json({ error: "Action impossible (Blocage actif)" });

            // Check Friend Status
            const friendCheck = await pool.query(`
                SELECT 1 FROM friend_requests 
                WHERE status = 'accepted' AND (
                    (sender_id = $1 AND receiver_id = $2) OR 
                    (sender_id = $2 AND receiver_id = $1)
                )
            `, [senderId, otherId]);
            if (friendCheck.rows.length === 0) return res.status(403).json({ error: "Vous devez être amis pour discuter." });
        }
    }
    
    let content = req.body.content;
    if (!content || content === 'undefined' || content === 'null') content = '';
    
    let attachmentUrl = req.body.attachment_url || null;
    let messageType = req.body.message_type || 'text';

    if (req.file) {
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder: `chat-app/conversations/${conversation_id}`, resource_type: "auto" },
                    (error, result) => { if (error) reject(error); else resolve(result); }
                );
                uploadStream.end(req.file.buffer);
            });
            attachmentUrl = uploadResult.secure_url;
            if (messageType !== 'audio') {
                messageType = 'image';
            }
        } catch (error) { return res.status(500).json({ error: "Échec upload média." }); }
    }

    if (!attachmentUrl && content.trim() === '') return res.status(400).json({ error: 'Message vide.' });

    try {
        const result = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, content, replied_to_message_id, message_type, attachment_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [conversation_id, senderId, content, replied_to_message_id || null, messageType, attachmentUrl] 
        );
        const msg = result.rows[0];

        await pool.query('INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [msg.id, senderId]);
        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        const userRes = await pool.query('SELECT username, tag, avatar_url FROM users WHERE id = $1', [senderId]);
        const sender = userRes.rows[0];
        
        let replyData = null;
        if (msg.replied_to_message_id) {
             const rRes = await pool.query(`SELECT m.content, u.username, u.tag FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.id = $1`, [msg.replied_to_message_id]);
             if (rRes.rows[0]) replyData = { id: msg.replied_to_message_id, content: rRes.rows[0].content, sender: `${rRes.rows[0].username}#${rRes.rows[0].tag}` };
        }

        const fullMsg = { 
            id: msg.id,
            conversation_id: msg.conversation_id,
            sender_id: msg.sender_id,
            content: msg.content === null ? "" : msg.content,
            created_at: msg.created_at,
            sender_username: `${sender.username}#${sender.tag}`, 
            sender_avatar: sender.avatar_url,
            read_count: 0, 
            reply: replyData,
            message_type: messageType,
            attachment_url: attachmentUrl, 
            image_url: attachmentUrl, 
            reactions: []
        }; 

        io.to(conversation_id).emit('new_message', fullMsg);
        
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversation_id]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_updated', { conversationId: conversation_id }));
        
        res.json(fullMsg);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [req.body.content, req.params.id]);
        const msg = result.rows[0];
        const uRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [msg.sender_id]);
        io.to(msg.conversation_id).emit('message_update', { ...msg, sender_username: `${uRes.rows[0].username}#${uRes.rows[0].tag}` });
        res.json(msg);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 RETURNING *', [req.params.id, req.user.id]);
        if (result.rows.length === 0) return res.status(403).json({ error: "Interdit." });
        const msg = result.rows[0];
        const uRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [msg.sender_id]);
        io.to(msg.conversation_id).emit('message_update', { ...msg, sender_username: `${uRes.rows[0].username}#${uRes.rows[0].tag}` });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friend_requests', authenticateToken, async (req, res) => {
    const { targetIdentifier } = req.body;
    const lastHash = targetIdentifier.lastIndexOf('#');
    if (lastHash === -1) return res.status(400).json({ error: "Format Nom#1234 requis" });
    const username = targetIdentifier.substring(0, lastHash).trim();
    const tag = targetIdentifier.substring(lastHash + 1).trim();

    try {
        const uRes = await pool.query('SELECT id FROM users WHERE UPPER(username) = UPPER($1) AND tag = $2', [username, tag]);
        const target = uRes.rows[0];
        if (!target) return res.status(404).json({ error: "Introuvable" });
        if (target.id === req.user.id) return res.status(400).json({ error: "Soi-même" });
        
        // Check blocks
        try {
            const blocked = await pool.query('SELECT 1 FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [req.user.id, target.id]);
            if (blocked.rows.length > 0) return res.status(400).json({ error: "Impossible d'ajouter cet utilisateur." });
        } catch(e) {/* ignore */}

        const exist = await pool.query('SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [req.user.id, target.id]);
        if (exist.rows.length > 0) return res.status(400).json({ error: "Déjà existant" });

        const newReq = await pool.query('INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) RETURNING *', [req.user.id, target.id]);
        io.to(`user:${target.id}`).emit('friend_request', newReq.rows[0]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/friend_requests', authenticateToken, async (req, res) => {
    try {
        const resQ = await pool.query(`SELECT r.*, u.username, u.tag, u.email, u.avatar_url FROM friend_requests r JOIN users u ON r.sender_id = u.id WHERE r.receiver_id = $1 AND r.status = 'pending'`, [req.user.id]);
        res.json(resQ.rows.map(r => ({ ...r, sender: { id: r.sender_id, username: r.username, tag: r.tag, email: r.email, avatar_url: r.avatar_url } })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friend_requests/:id/respond', authenticateToken, async (req, res) => {
    const { status } = req.body; 
    try {
        const rRes = await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
        const reqData = rRes.rows[0];
        
        if (status === 'accepted') {
            const exist = await pool.query(`
                SELECT c.id FROM conversations c
                JOIN participants p1 ON c.id = p1.conversation_id
                JOIN participants p2 ON c.id = p2.conversation_id
                WHERE c.is_group = FALSE AND p1.user_id = $1 AND p2.user_id = $2
            `, [reqData.sender_id, reqData.receiver_id]);

            let cid;
            if (exist.rows.length > 0) {
                cid = exist.rows[0].id;
                await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [cid]);
            } else {
                const cRes = await pool.query('INSERT INTO conversations (is_group) VALUES (false) RETURNING id');
                cid = cRes.rows[0].id;
                await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2), ($3, $2)', [reqData.sender_id, cid, reqData.receiver_id]);
            }
            
            await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [cid, reqData.receiver_id, '👋 Ami accepté !']);
            io.to(`user:${reqData.sender_id}`).emit('conversation_added', { conversationId: cid });
            io.to(`user:${reqData.receiver_id}`).emit('conversation_added', { conversationId: cid });
            res.json({ success: true, conversationId: cid });
        } else res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// JSON 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: "Route not found", path: req.url });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
