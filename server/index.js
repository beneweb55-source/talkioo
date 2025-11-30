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

// --- HELPER: UUID Generator (Node.js Safe Polyfill) ---
function generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
    );
}

// --- DB INITIALIZATION ---
const initDB = async () => {
    try {
        console.log("Initializing Database...");

        try {
            await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        } catch (e) {
            console.warn("Could not create extension pgcrypto:", e.message);
        }

        // 1. Core Tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                tag TEXT NOT NULL,
                avatar_url TEXT,
                theme_color TEXT DEFAULT 'orange',
                is_online BOOLEAN DEFAULT FALSE,
                socket_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
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
        `);

        // 2. Auxiliary Tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS friend_requests (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
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

        // 3. Blocked Users (Robust)
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
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_blocked_blocker ON blocked_users(blocker_id)`);
        } catch (e) {
            console.error("Error creating blocked_users table:", e.message);
        }
        
        // Add columns if they don't exist (migrations)
        await pool.query(`
            ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_deleted_at TIMESTAMPTZ;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS replied_to_message_id UUID REFERENCES messages(id);
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_color TEXT DEFAULT 'orange';
        `);

        console.log("Database initialized successfully");
    } catch (err) {
        console.error("Error initializing database:", err);
    }
};

// Call initDB on startup
initDB();

// --- MIDDLEWARE ---
app.use((req, res, next) => {
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

// ... (messages, stickers, reactions routes unchanged)

app.post('/api/messages', authenticateToken, upload.single('media'), async (req, res) => {
    const { conversation_id, replied_to_message_id } = req.body;
    const senderId = req.user.id;
    
    const convCheck = await pool.query('SELECT is_group FROM conversations WHERE id = $1', [conversation_id]);
    if (!convCheck.rows[0]) return res.status(404).json({ error: "Conversation introuvable" });

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
            if (messageType !== 'audio') messageType = 'image';
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

        // Socket.IO Emit
        io.to(conversation_id).emit('new_message', fullMsg);
        const pRes = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [conversation_id]);
        pRes.rows.forEach(r => io.to(`user:${r.user_id}`).emit('conversation_updated', { conversationId: conversation_id }));
        
        res.json(fullMsg);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gifs/search', async (req, res) => {
    const { q, pos } = req.query;
    const apiKey = process.env.TENOR_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Tenor API Key not configured" });
    try {
        let url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${apiKey}&client_key=talkio&limit=20&media_filter=minimal`;
        if (pos) url += `&pos=${pos}`;
        const response = await fetch(url);
        res.json(await response.json());
    } catch (error) { res.status(500).json({ error: "Failed to fetch GIFs" }); }
});

app.get('/api/gifs/trending', async (req, res) => {
    const { pos } = req.query;
    const apiKey = process.env.TENOR_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Tenor API Key not configured" });
    try {
        let url = `https://tenor.googleapis.com/v2/featured?key=${apiKey}&client_key=talkio&limit=20&media_filter=minimal`;
        if (pos) url += `&pos=${pos}`;
        const response = await fetch(url);
        res.json(await response.json());
    } catch (error) { res.status(500).json({ error: "Failed to fetch GIFs" }); }
});

app.get('/api/stickers', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM stickers WHERE user_id IS NULL OR user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stickers', authenticateToken, upload.single('sticker'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier" });
    try {
        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream({ folder: `chat-app/stickers/${req.user.id}`, resource_type: "image" }, (error, result) => { if (error) reject(error); else resolve(result); });
            uploadStream.end(req.file.buffer);
        });
        const result = await pool.query('INSERT INTO stickers (url, user_id) VALUES ($1, $2) RETURNING *', [uploadResult.secure_url, req.user.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: "Erreur upload" }); }
});

app.post('/api/messages/:id/react', authenticateToken, async (req, res) => {
    const messageId = req.params.id;
    const userId = req.user.id;
    const { emoji } = req.body; 
    try {
        const msgCheck = await pool.query('SELECT conversation_id FROM messages WHERE id = $1', [messageId]);
        if (msgCheck.rows.length === 0) return res.status(404).json({ error: "Message introuvable" });
        const conversationId = msgCheck.rows[0].conversation_id;
        
        const existing = await pool.query('SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, userId, emoji]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM message_reactions WHERE id = $1', [existing.rows[0].id]);
        } else {
            await pool.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [messageId, userId, emoji]);
        }
        
        const resReactions = await pool.query(`SELECT mr.emoji, mr.user_id, u.username FROM message_reactions mr JOIN users u ON mr.user_id = u.id WHERE mr.message_id = $1`, [messageId]);
        io.to(conversationId).emit('message_reaction_update', { messageId, reactions: resReactions.rows });
        res.json({ success: true, reactions: resReactions.rows });
    } catch (err) { res.status(500).json({ error: "Erreur serveur" }); }
});

app.post('/api/auth/register', async (req, res) => {
    let { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tag = Math.floor(1000 + Math.random() * 9000).toString();
        const result = await pool.query('INSERT INTO users (username, email, password_hash, tag, theme_color) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, tag, email, created_at, avatar_url, theme_color', [username.trim(), email.toLowerCase().trim(), hashedPassword, tag, 'orange']);
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        res.json({ user, token });
    } catch (err) { res.status(400).json({ error: "Email déjà pris" }); }
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

app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id FROM users WHERE is_online = TRUE');
        res.json(result.rows.map(u => u.id));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/profile', authenticateToken, upload.single('avatar'), async (req, res) => {
    const { username, email, theme_color } = req.body;
    let avatarUrl = null;
    if (req.file) {
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream({ folder: `chat-app/avatars`, resource_type: "image", transformation: [{ width: 300, height: 300, crop: "fill", gravity: "face" }] }, (error, result) => { if (error) reject(error); else resolve(result); });
                uploadStream.end(req.file.buffer);
            });
            avatarUrl = uploadResult.secure_url;
        } catch (error) { return res.status(500).json({ error: "Erreur upload" }); }
    }
    try {
        // Update query handles theme_color
        const result = await pool.query(
            'UPDATE users SET username = COALESCE($1, username), email = COALESCE($2, email), avatar_url = COALESCE($3, avatar_url), theme_color = COALESCE($4, theme_color) WHERE id = $5 RETURNING id, username, tag, email, created_at, avatar_url, theme_color', 
            [username, email, avatarUrl, theme_color, req.user.id]
        );
        io.emit('USER_PROFILE_UPDATE', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ... (Rest of routes: blocked, friends, conversations, etc. unchanged)

// Moved blocked users route up
app.get('/api/users/blocked', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT u.id, u.username, u.tag, u.avatar_url, b.created_at FROM blocked_users b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`, [req.user.id]);
        res.json(result.rows);
    } catch (err) { 
        if (err.code === '42P01') {
             try { await pool.query(`CREATE TABLE IF NOT EXISTS blocked_users (id UUID PRIMARY KEY, blocker_id UUID REFERENCES users(id) ON DELETE CASCADE, blocked_id UUID REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(blocker_id, blocked_id))`); return res.json([]); } catch (e) { return res.status(500).json({ error: e.message }); }
        }
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, tag, email, is_online, avatar_url FROM users WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/block', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    if (!userId || userId === req.user.id) return res.status(400).json({ error: "Invalid User" });
    try {
        const id = generateUUID();
        await pool.query('INSERT INTO blocked_users (id, blocker_id, blocked_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, req.user.id, userId]);
        res.json({ success: true });
    } catch (err) { 
        if (err.code === '42P01') {
            try {
                await pool.query(`CREATE TABLE IF NOT EXISTS blocked_users (id UUID PRIMARY KEY, blocker_id UUID REFERENCES users(id) ON DELETE CASCADE, blocked_id UUID REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(blocker_id, blocked_id))`);
                const id = generateUUID();
                await pool.query('INSERT INTO blocked_users (id, blocker_id, blocked_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, req.user.id, userId]);
                return res.json({ success: true });
            } catch(e) { return res.status(500).json({ error: e.message }); }
        }
        res.status(500).json({ error: err.message }); 
    }
});

// ... (other routes unchanged)

app.get('/', (req, res) => res.send("Talkio Backend is Running 🚀"));
app.use((req, res) => { res.status(404).json({ error: "Route not found", path: req.url }); });

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
