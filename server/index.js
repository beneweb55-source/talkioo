const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// --- CONFIGURATION ---
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'super_secret_key_change_this_in_prod';

// Configuration Cloudinary (Lecture depuis les variables d'environnement Render)
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

// --- HELPER FUNCTIONS ---
const getAggregatedReactions = async (messageId) => {
    try {
        // Retourne un tableau d'objets { emoji, user_id }
        const res = await pool.query('SELECT emoji, user_id FROM message_reactions WHERE message_id = $1', [messageId]);
        return res.rows;
    } catch (err) {
        console.error("Error aggregating reactions:", err);
        return [];
    }
};

// --- MIDDLEWARE ---
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
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
    pingTimeout: 60000, // Increase timeout to 60s
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

// 1. REACTIONS ROUTE (Priority High - Explicit Definition)
app.post('/api/messages/:id/react', authenticateToken, async (req, res) => {
    const messageId = req.params.id;
    const userId = req.user.id;
    const { emoji } = req.body; 

    console.log(`[DEBUG-REACTION] Réaction reçue pour message ${messageId} par ${userId} : ${emoji}`);

    try {
        // 1. Check if message exists and get conversation ID
        const msgCheck = await pool.query('SELECT conversation_id FROM messages WHERE id = $1', [messageId]);
        if (msgCheck.rows.length === 0) {
            console.log(`[DEBUG-REACTION] Message ${messageId} not found`);
            return res.status(404).json({ error: "Message introuvable" });
        }
        const conversationId = msgCheck.rows[0].conversation_id;

        // 2. Handle Reaction Logic
        if (!emoji) {
            // Suppression de la réaction
            await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [messageId, userId]);
        } else {
            // Toggle Logic: If exists with same emoji -> remove it. If different -> update. If none -> insert.
            const existing = await pool.query('SELECT emoji FROM message_reactions WHERE message_id = $1 AND user_id = $2', [messageId, userId]);
            
            if (existing.rows.length > 0) {
                if (existing.rows[0].emoji === emoji) {
                    // Same emoji: Remove it (Toggle off)
                    await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2', [messageId, userId]);
                } else {
                    // Different emoji: Update it
                    await pool.query('UPDATE message_reactions SET emoji = $3, created_at = NOW() WHERE message_id = $1 AND user_id = $2', [messageId, userId, emoji]);
                }
            } else {
                // New reaction
                await pool.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)', [messageId, userId, emoji]);
            }
        }

        // 3. Get updated list using Helper
        const reactions = await getAggregatedReactions(messageId);
        
        // 4. Broadcast
        io.to(conversationId).emit('message_reaction_update', {
            messageId: messageId,
            reactions: reactions
        });

        res.json({ success: true, reactions });
    } catch (err) {
        console.error("[DEBUG-REACTION] Erreur:", err);
        res.status(500).json({ error: "Erreur serveur réaction" });
    }
});

console.log("[SERVER STARTUP] Route /api/messages/:id/react registered successfully.");

app.get('/', (req, res) => res.send("Talkio Backend is Running 🚀"));

// AUTH
app.post('/api/auth/register', async (req, res) => {
    let { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tag = Math.floor(1000 + Math.random() * 9000).toString();
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, tag) VALUES ($1, $2, $3, $4) RETURNING id, username, tag, email, created_at',
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

// USERS
app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id FROM users WHERE is_online = TRUE');
        res.json(result.rows.map(u => u.id));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, tag, email, is_online FROM users WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.username, u.tag, u.email, u.is_online, fr.status AS friend_status, c.id AS conversation_id
            FROM friend_requests fr
            JOIN users u ON (CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END) = u.id
            LEFT JOIN participants p1 ON p1.user_id = fr.sender_id AND p1.conversation_id IN (
                SELECT p2.conversation_id FROM participants p2 WHERE p2.user_id = fr.receiver_id
            )
            LEFT JOIN conversations c ON c.id = p1.conversation_id AND c.is_group = FALSE
            WHERE (fr.sender_id = $1 OR fr.receiver_id = $1) AND fr.status = 'accepted'
        `;
        const result = await pool.query(query, [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CONVERSATIONS
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
            participantPlaceholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
            participantValues.push(allParticipants[i], conversationId);
        }
        await pool.query(`INSERT INTO participants (user_id, conversation_id) VALUES ${participantPlaceholders.join(', ')}`, participantValues);
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [conversationId, userId, is_group ? `👋 Groupe "${name}" créé !` : '👋 Nouvelle discussion.']);
        
        allParticipants.forEach(uid => io.to(`user:${uid}`).emit('conversation_added', { conversationId }));
        res.status(201).json({ conversationId, name, is_group, participants: allParticipants });
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
        
        const enriched = await Promise.all(result.rows.map(async (row) => {
            let displayName = row.name;
            if (!row.is_group) {
                const otherPRes = await pool.query(`
                    SELECT u.username, u.tag FROM participants p JOIN users u ON p.user_id = u.id 
                    WHERE p.conversation_id = $1 ORDER BY (p.user_id = $2) ASC LIMIT 1
                `, [row.id, req.user.id]);
                if (otherPRes.rows.length > 0) {
                    const u = otherPRes.rows[0];
                    displayName = `${u.username}#${u.tag}`;
                } else { displayName = "Discussion"; }
            }
            return {
                ...row,
                name: displayName || "Discussion",
                last_message: row.last_message_deleted ? "🚫 Message supprimé" : (row.last_message_content || "Nouvelle discussion"),
                last_message_at: row.last_message_time || row.created_at
            };
        }));
        res.json(enriched);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE participants SET last_deleted_at = NOW() WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
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
        const result = await pool.query(`
            SELECT json_build_object('id', u.id, 'username', u.username, 'tag', u.tag, 'email', u.email, 'is_online', u.is_online) as user_data
            FROM participants p JOIN users u ON p.user_id = u.id 
            WHERE p.conversation_id = $1 ORDER BY (p.user_id = $2) ASC LIMIT 1
        `, [req.params.id, req.user.id]);
        res.json(result.rows[0]?.user_data || null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                m.*, 
                u.username, u.tag,
                (SELECT COUNT(*) FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id != $2) AS read_count,
                m2.content AS replied_to_content, u2.username AS replied_to_username, u2.tag AS replied_to_tag,
                m2.message_type AS replied_to_type, m2.attachment_url AS replied_to_attachment_url,
                (
                    SELECT json_agg(json_build_object('emoji', mr.emoji, 'user_id', mr.user_id))
                    FROM message_reactions mr
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
        if (err) {
            console.error('[MULTER DEBUG] Error:', err);
            return res.status(500).json({ error: `Upload Error: ${err.message}` });
        }
        next();
    });
}, async (req, res) => {
    console.log(`[DEBUG-RENDER] Route POST /api/messages atteinte`);
    const { conversation_id, replied_to_message_id } = req.body;
    const senderId = req.user.id;
    
    let content = req.body.content;
    if (!content || content === 'undefined' || content === 'null') {
        content = '';
    }

    let attachmentUrl = null;
    let messageType = 'text';

    // --- LOGIQUE DE TÉLÉCHARGEMENT CLOUDINARY ---
    if (req.file) {
        console.log(`[DEBUG-RENDER] Start Upload: ${req.file.originalname}`);
        try {
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder: `chat-app/conversations/${conversation_id}`,
                        resource_type: "auto"
                    },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result); 
                    }
                );
                uploadStream.end(req.file.buffer);
            });

            attachmentUrl = uploadResult.secure_url;
            messageType = 'image';
            console.log(`[DEBUG-RENDER] Upload Final URL: ${attachmentUrl}`);

        } catch (error) {
            console.error('[DEBUG-RENDER] ❌ ERROR CLOUDINARY:', error);
            return res.status(500).json({ error: "Échec upload média." });
        }
    }

    if (!attachmentUrl && content.trim() === '') {
         return res.status(400).json({ error: 'Message vide.' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, content, replied_to_message_id, message_type, attachment_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [conversation_id, senderId, content, replied_to_message_id || null, messageType, attachmentUrl] 
        );
        const msg = result.rows[0];

        await pool.query('INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [msg.id, senderId]);
        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [senderId]);
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
    } catch (err) {
        console.error("[DEBUG-RENDER] SQL/Logic Error:", err);
        res.status(500).json({ error: err.message });
    }
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
        
        const exist = await pool.query('SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [req.user.id, target.id]);
        if (exist.rows.length > 0) return res.status(400).json({ error: "Déjà existant" });

        const newReq = await pool.query('INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) RETURNING *', [req.user.id, target.id]);
        io.to(`user:${target.id}`).emit('friend_request', newReq.rows[0]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/friend_requests', authenticateToken, async (req, res) => {
    try {
        const resQ = await pool.query(`SELECT r.*, u.username, u.tag, u.email FROM friend_requests r JOIN users u ON r.sender_id = u.id WHERE r.receiver_id = $1 AND r.status = 'pending'`, [req.user.id]);
        res.json(resQ.rows.map(r => ({ ...r, sender: { id: r.sender_id, username: r.username, tag: r.tag, email: r.email } })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/friend_requests/:id/respond', authenticateToken, async (req, res) => {
    const { status } = req.body; 
    try {
        const rRes = await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
        const reqData = rRes.rows[0];
        if (status === 'accepted') {
            const cRes = await pool.query('INSERT INTO conversations (is_group) VALUES (false) RETURNING id');
            const cid = cRes.rows[0].id;
            await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2), ($3, $2)', [reqData.sender_id, cid, reqData.receiver_id]);
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
