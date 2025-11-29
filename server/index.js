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
    } catch (err) {
        console.error("Get stickers error", err);
        res.sendStatus(500);
    }
});

app.post('/api/stickers', authenticateToken, upload.single('sticker'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier" });
    try {
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        const cloudinaryRes = await cloudinary.uploader.upload(dataURI, { folder: 'stickers' });
        
        const result = await pool.query(
            'INSERT INTO stickers (url, user_id) VALUES ($1, $2) RETURNING *',
            [cloudinaryRes.secure_url, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Upload sticker error", err);
        res.sendStatus(500);
    }
});

// --- BLOCKING ROUTES ---

app.post('/api/users/block', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.sendStatus(400);
    try {
        await pool.query(
            'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.user.id, userId]
        );
        res.sendStatus(200);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.post('/api/users/unblock', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.sendStatus(400);
    try {
        await pool.query(
            'DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2',
            [req.user.id, userId]
        );
        res.sendStatus(200);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.get('/api/users/blocked', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar_url, u.email, u.created_at
            FROM blocked_users b
            JOIN users u ON b.blocked_id = u.id
            WHERE b.blocker_id = $1
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.delete('/api/friends/:id', authenticateToken, async (req, res) => {
    const friendId = req.params.id;
    try {
        // Supprimer toutes les requêtes d'amis existantes (dans les deux sens)
        await pool.query(
            'DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)',
            [req.user.id, friendId]
        );
        // On pourrait aussi "soft delete" la conversation, mais c'est une autre logique
        res.sendStatus(200);
    } catch (err) { console.error(err); res.sendStatus(500); }
});


// --- AUTH ROUTES ---

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const tag = Math.floor(1000 + Math.random() * 9000).toString();
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, tag) VALUES ($1, $2, $3, $4) RETURNING id, username, email, tag, created_at, avatar_url',
            [username, email, hashedPassword, tag]
        );
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id }, JWT_SECRET);
        res.json({ user, token });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: "Email déjà utilisé" });
        res.status(500).json({ error: "Erreur serveur" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user || !await bcrypt.compare(password, user.password_hash)) {
            return res.status(401).json({ error: "Identifiants incorrects" });
        }
        const token = jwt.sign({ id: user.id }, JWT_SECRET);
        delete user.password_hash;
        res.json({ user, token });
    } catch (err) { res.status(500).json({ error: "Erreur serveur" }); }
});

app.put('/api/users/profile', authenticateToken, upload.single('avatar'), async (req, res) => {
    const { username, email } = req.body;
    let avatarUrl = undefined;
    
    if (req.file) {
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        const cloudinaryRes = await cloudinary.uploader.upload(dataURI, { folder: 'avatars' });
        avatarUrl = cloudinaryRes.secure_url;
    }

    try {
        let query = 'UPDATE users SET username = COALESCE($1, username), email = COALESCE($2, email)';
        const params = [username || null, email || null];
        
        if (avatarUrl) {
            query += `, avatar_url = $${params.length + 1}`;
            params.push(avatarUrl);
        }
        
        query += ` WHERE id = $${params.length + 1} RETURNING id, username, tag, email, created_at, avatar_url`;
        params.push(req.user.id);

        const result = await pool.query(query, params);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];
        
        if (!await bcrypt.compare(oldPassword, user.password_hash)) {
            return res.status(400).json({ error: "Ancien mot de passe incorrect" });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts', authenticateToken, async (req, res) => {
    try {
        // Utiliser DISTINCT ON pour éviter les doublons si plusieurs liens existent
        const result = await pool.query(`
            SELECT DISTINCT ON (u.id) u.id, u.username, u.tag, u.avatar_url, u.is_online
            FROM users u
            JOIN friend_requests fr ON (fr.sender_id = u.id AND fr.receiver_id = $1) OR (fr.receiver_id = u.id AND fr.sender_id = $1)
            WHERE fr.status = 'accepted'
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id FROM users WHERE is_online = TRUE');
        res.json(result.rows.map(r => r.id));
    } catch (err) { res.sendStatus(500); }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.* 
            FROM conversations c
            JOIN participants p ON p.conversation_id = c.id
            WHERE p.user_id = $1 AND (p.last_deleted_at IS NULL OR p.last_deleted_at < c.updated_at)
            ORDER BY c.updated_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.sendStatus(500); }
});

app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { name, participantIds } = req.body; // IDs only, not me
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const convRes = await client.query(
            'INSERT INTO conversations (name, is_group) VALUES ($1, $2) RETURNING id',
            [name || null, true]
        );
        const convId = convRes.rows[0].id;

        const allParticipants = [req.user.id, ...participantIds];
        for (const pid of allParticipants) {
            await client.query(
                'INSERT INTO participants (conversation_id, user_id, role) VALUES ($1, $2, $3)',
                [convId, pid, pid === req.user.id ? 'admin' : 'member']
            );
        }

        // System message
        await client.query(
            'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)',
            [convId, req.user.id, `Groupe "${name}" créé.`]
        );

        await client.query('COMMIT');
        
        // Notify
        allParticipants.forEach(pid => {
            io.to(`user:${pid}`).emit('conversation_added');
        });

        res.json({ conversationId: convId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.sendStatus(500);
    } finally {
        client.release();
    }
});

app.get('/api/conversations/:id/other', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar_url, u.is_online
            FROM participants p
            JOIN users u ON u.id = p.user_id
            WHERE p.conversation_id = $1 AND p.user_id != $2
            LIMIT 1
        `, [req.params.id, req.user.id]);
        
        const otherUser = result.rows[0];
        if (otherUser) {
            // Check blocking status
            const blockRes = await pool.query(
                'SELECT blocker_id, blocked_id FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
                [req.user.id, otherUser.id]
            );
            
            const blockData = blockRes.rows;
            const isBlockedByMe = blockData.some(b => b.blocker_id === req.user.id);
            const isBlockingMe = blockData.some(b => b.blocker_id === otherUser.id);
            
            if (isBlockedByMe || isBlockingMe) {
                 return res.json({
                     id: otherUser.id,
                     username: "Utilisateur Evo",
                     tag: "0000",
                     avatar_url: null,
                     is_online: false,
                     is_blocked_by_me: isBlockedByMe,
                     is_blocking_me: isBlockingMe
                 });
            }
            
            return res.json({
                 ...otherUser,
                 is_blocked_by_me: isBlockedByMe,
                 is_blocking_me: isBlockingMe
            });
        }
        res.sendStatus(404);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.get('/api/conversations/:id/members', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar_url, p.role, p.joined_at
            FROM participants p
            JOIN users u ON u.id = p.user_id
            WHERE p.conversation_id = $1
            ORDER BY p.role ASC, u.username ASC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.sendStatus(500); }
});

app.post('/api/conversations/:id/members', authenticateToken, async (req, res) => {
    const { userIds } = req.body;
    try {
        // Check admin
        const adminCheck = await pool.query('SELECT role FROM participants WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        // Allow adding if group logic permits (for now let's allow any member to add or just admin)
        
        for (const uid of userIds) {
             await pool.query('INSERT INTO participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
        }
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [req.params.id, req.user.id, "Nouveaux membres ajoutés."]);
        
        // Notify new members
        userIds.forEach(uid => io.to(`user:${uid}`).emit('conversation_added'));
        io.to(req.params.id).emit('conversation_updated'); // Notify room

        res.sendStatus(200);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.delete('/api/conversations/:id/members/:userId', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM participants WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [req.params.id, req.user.id, "Membre exclu."]);
        io.to(`user:${req.params.userId}`).emit('conversation_removed');
        io.to(req.params.id).emit('conversation_updated');
        res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
});

app.delete('/api/conversations/:id/leave', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM participants WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [req.params.id, req.user.id, "A quitté le groupe."]);
        io.to(req.params.id).emit('conversation_updated');
        res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
});

app.delete('/api/conversations/:id/destroy', authenticateToken, async (req, res) => {
    try {
        const adminCheck = await pool.query('SELECT role FROM participants WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (adminCheck.rows[0]?.role !== 'admin') return res.status(403).json({ error: "Admin only" });

        // Get members to notify
        const members = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1', [req.params.id]);
        
        await pool.query('DELETE FROM conversations WHERE id = $1', [req.params.id]);
        
        members.rows.forEach(m => io.to(`user:${m.user_id}`).emit('conversation_removed'));
        res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
});

app.put('/api/conversations/:id', authenticateToken, upload.single('avatar'), async (req, res) => {
    const { name } = req.body;
    let avatarUrl = undefined;
    if (req.file) {
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        const cloudinaryRes = await cloudinary.uploader.upload(dataURI, { folder: 'groups' });
        avatarUrl = cloudinaryRes.secure_url;
    }

    try {
        let query = 'UPDATE conversations SET updated_at = NOW()';
        const params = [req.params.id];
        let idx = 2;

        if (name) { query += `, name = $${idx++}`; params.push(name); }
        if (avatarUrl) { query += `, avatar_url = $${idx++}`; params.push(avatarUrl); }
        
        query += ` WHERE id = $1 RETURNING *`;
        
        const result = await pool.query(query, params);
        io.to(req.params.id).emit('conversation_updated');
        res.json(result.rows[0]);
    } catch (err) { res.sendStatus(500); }
});

app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'UPDATE participants SET last_deleted_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        // Fetch Messages
        const msgs = await pool.query(`
            SELECT m.*, u.username, u.tag
            FROM messages m 
            JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1 AND m.deleted_at IS NULL
            ORDER BY m.created_at ASC
        `, [req.params.id]);

        // Check if I am blocked by sender (or I blocked sender)
        // If so, mask sender name
        const blockRes = await pool.query(
            'SELECT blocker_id, blocked_id FROM blocked_users WHERE blocker_id = $1 OR blocked_id = $1',
            [req.user.id]
        );
        const blocks = blockRes.rows;

        const enrichedMessages = await Promise.all(msgs.rows.map(async (msg) => {
            const reactions = await getAggregatedReactions(msg.id);
            
            // Masking Logic for Messages
            const isBlockedRelation = blocks.some(b => 
                (b.blocker_id === req.user.id && b.blocked_id === msg.sender_id) || 
                (b.blocker_id === msg.sender_id && b.blocked_id === req.user.id)
            );
            
            const senderName = isBlockedRelation ? "Utilisateur Evo" : `${msg.username}#${msg.tag}`;

            return {
                ...msg,
                sender_username: senderName,
                reactions: reactions
            };
        }));
        
        res.json(enrichedMessages);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.post('/api/messages', authenticateToken, upload.single('media'), async (req, res) => {
    const { conversation_id, content, replied_to_message_id, message_type, attachment_url } = req.body;
    
    // Check blocking before sending
    try {
        // Find other participant in 1:1
        const convInfo = await pool.query('SELECT is_group FROM conversations WHERE id = $1', [conversation_id]);
        if (!convInfo.rows[0].is_group) {
             const otherPart = await pool.query('SELECT user_id FROM participants WHERE conversation_id = $1 AND user_id != $2', [conversation_id, req.user.id]);
             if (otherPart.rows[0]) {
                 const otherId = otherPart.rows[0].user_id;
                 const blockCheck = await pool.query('SELECT 1 FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [req.user.id, otherId]);
                 if (blockCheck.rows.length > 0) return res.status(403).json({ error: "Communication bloquée" });
                 
                 // Also check friend status (optional, user requested "cannot converse if remove friend")
                 // Assuming "Remove Friend" keeps conversation but prevents new messages? Or just standard block?
                 // Let's stick to Blocking prevents messages. Removing friend usually just removes from contact list but allows chat until blocked.
             }
        }
    } catch(e) { console.error(e); }

    let finalAttachmentUrl = attachment_url || null;
    let finalType = message_type || 'text';

    if (req.file) {
        try {
            const b64 = Buffer.from(req.file.buffer).toString('base64');
            const dataURI = `data:${req.file.mimetype};base64,${b64}`;
            
            const resourceType = req.file.mimetype.startsWith('audio') ? 'video' : 'auto'; 
            // Cloudinary treats audio as video often, or auto.
            
            const cloudinaryRes = await cloudinary.uploader.upload(dataURI, { 
                folder: 'attachments', 
                resource_type: resourceType 
            });
            finalAttachmentUrl = cloudinaryRes.secure_url;
            
            if (req.file.mimetype.startsWith('image')) finalType = 'image';
            else if (req.file.mimetype.startsWith('audio')) finalType = 'audio';
            else finalType = 'file';
        } catch(e) { console.error(e); return res.sendStatus(500); }
    }

    try {
        const result = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, content, replied_to_message_id, message_type, attachment_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [conversation_id, req.user.id, content, replied_to_message_id || null, finalType, finalAttachmentUrl]
        );
        const newMsg = result.rows[0];
        
        await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversation_id]);
        // Restore soft-deleted conversation for everyone
        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        io.to(conversation_id).emit('new_message', newMsg);
        io.to(conversation_id).emit('conversation_updated');
        res.json(newMsg);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const msgCheck = await pool.query('SELECT sender_id, conversation_id FROM messages WHERE id = $1', [req.params.id]);
        if (msgCheck.rows[0]?.sender_id !== req.user.id) return res.sendStatus(403);

        await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = $1', [req.params.id]);
        io.to(msgCheck.rows[0].conversation_id).emit('message_update', { id: req.params.id, deleted_at: new Date() });
        res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
});

app.put('/api/messages/:id', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const msgCheck = await pool.query('SELECT sender_id, conversation_id FROM messages WHERE id = $1', [req.params.id]);
        if (msgCheck.rows[0]?.sender_id !== req.user.id) return res.sendStatus(403);

        const result = await pool.query('UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [content, req.params.id]);
        io.to(msgCheck.rows[0].conversation_id).emit('message_update', result.rows[0]);
        res.json(result.rows[0]);
    } catch (err) { res.sendStatus(500); }
});

app.post('/api/messages/:id/react', authenticateToken, async (req, res) => {
    const { emoji } = req.body;
    try {
        const existing = await pool.query('SELECT * FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [req.params.id, req.user.id, emoji]);
        if (existing.rows.length > 0) {
            await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [req.params.id, req.user.id, emoji]);
        } else {
            await pool.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)', [req.params.id, req.user.id, emoji]);
        }
        
        const reactions = await getAggregatedReactions(req.params.id);
        const msgRes = await pool.query('SELECT conversation_id FROM messages WHERE id = $1', [req.params.id]);
        
        io.to(msgRes.rows[0].conversation_id).emit('message_reaction_update', { messageId: req.params.id, reactions });
        res.json(reactions);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.post('/api/conversations/:id/read', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE messages SET read_count = read_count + 1 WHERE conversation_id = $1 AND sender_id != $2 AND read_count = 0', [req.params.id, req.user.id]);
        // Ideally verify specific logic for 1:1 vs group read receipts
        io.to(req.params.id).emit('READ_RECEIPT_UPDATE', { conversationId: req.params.id });
        res.sendStatus(200);
    } catch(e) { console.error(e); res.sendStatus(500); }
});

app.get('/api/friend_requests', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT fr.*, u.username, u.tag, u.email 
            FROM friend_requests fr 
            JOIN users u ON fr.sender_id = u.id 
            WHERE fr.receiver_id = $1 AND fr.status = 'pending'
        `, [req.user.id]);
        
        // Map to nested structure expected by frontend
        const requests = result.rows.map(r => ({
            ...r,
            sender: { username: r.username, tag: r.tag, email: r.email }
        }));
        res.json(requests);
    } catch (err) { res.sendStatus(500); }
});

app.post('/api/friend_requests', authenticateToken, async (req, res) => {
    const { targetIdentifier } = req.body;
    const [username, tag] = targetIdentifier.split('#');
    if (!username || !tag) return res.status(400).json({ error: "Format invalide (Nom#1234)" });

    try {
        const userRes = await pool.query('SELECT id FROM users WHERE username = $1 AND tag = $2', [username, tag]);
        const targetUser = userRes.rows[0];
        
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });
        if (targetUser.id === req.user.id) return res.status(400).json({ error: "Impossible de s'ajouter soi-même" });

        const checkRes = await pool.query('SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [req.user.id, targetUser.id]);
        if (checkRes.rows.length > 0) {
            if (checkRes.rows[0].status === 'pending') return res.status(400).json({ error: "Demande déjà en attente" });
            if (checkRes.rows[0].status === 'accepted') {
                // Check if we need to restore a hidden conversation
                // Logic: respondFriendRequest usually handles chat creation
                // We'll just say already friends
                return res.status(400).json({ error: "Déjà amis" });
            }
        }

        await pool.query('INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2)', [req.user.id, targetUser.id]);
        io.to(`user:${targetUser.id}`).emit('friend_request');
        res.sendStatus(200);
    } catch (err) { console.error(err); res.sendStatus(500); }
});

app.post('/api/friend_requests/:id/respond', authenticateToken, async (req, res) => {
    const { status } = req.body;
    try {
        const frRes = await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
        const request = frRes.rows[0];
        
        let conversationId = null;

        if (status === 'accepted') {
            // Check if conversation already exists (even if deleted)
            const existingConv = await pool.query(`
                SELECT c.id FROM conversations c
                JOIN participants p1 ON c.id = p1.conversation_id
                JOIN participants p2 ON c.id = p2.conversation_id
                WHERE p1.user_id = $1 AND p2.user_id = $2 AND c.is_group = FALSE
            `, [request.sender_id, request.receiver_id]);

            if (existingConv.rows.length > 0) {
                conversationId = existingConv.rows[0].id;
                // Reactivate
                await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversationId]);
            } else {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const convRes = await client.query('INSERT INTO conversations (is_group) VALUES (FALSE) RETURNING id');
                    conversationId = convRes.rows[0].id;
                    await client.query('INSERT INTO participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)', [conversationId, request.sender_id, request.receiver_id]);
                    await client.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [conversationId, request.receiver_id, "👋 Ami accepté !"]);
                    await client.query('COMMIT');
                } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
            }
            
            io.to(`user:${request.sender_id}`).emit('request_accepted');
            io.to(`user:${request.receiver_id}`).emit('request_accepted');
        }
        res.json({ conversationId });
    } catch (err) { console.error(err); res.sendStatus(500); }
});

// Init DB
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                tag TEXT NOT NULL,
                avatar_url TEXT,
                socket_id TEXT,
                is_online BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                name TEXT,
                is_group BOOLEAN DEFAULT FALSE,
                avatar_url TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS participants (
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                role TEXT DEFAULT 'member',
                joined_at TIMESTAMPTZ DEFAULT NOW(),
                last_deleted_at TIMESTAMPTZ,
                PRIMARY KEY (conversation_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                content TEXT,
                message_type TEXT DEFAULT 'text',
                attachment_url TEXT,
                replied_to_message_id UUID,
                read_count INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ,
                deleted_at TIMESTAMPTZ
            );
            CREATE TABLE IF NOT EXISTS message_reactions (
                message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                emoji TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (message_id, user_id, emoji)
            );
            CREATE TABLE IF NOT EXISTS friend_requests (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
                receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'pending', -- pending, accepted, rejected
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS stickers (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                url TEXT NOT NULL,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS blocked_users (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
                blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(blocker_id, blocked_id)
            );
        `);
        console.log("DB Tables Initialized");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
};

initDB();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});