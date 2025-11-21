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
const PORT = 3001; // Backend Port
const JWT_SECRET = 'super_secret_key_change_this_in_prod';

// Use the connection string you provided
const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_XPSO1Fe6aqZk@ep-misty-queen-agi42tnv-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: connectionString,
});

// --- MIDDLEWARE ---
app.use(cors()); // Allow frontend to communicate
app.use(express.json());

// --- SOCKET.IO SETUP ---
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for MVP
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // TODO: Mise à jour du statut en ligne (lorsque l'authentification est gérée)
    // C'est ici que tu mettras le code pour UPDATE users SET is_online = TRUE, socket_id = socket.id


    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
    });
    
    socket.on('join_user_channel', (userId) => {
        socket.join(`user:${userId}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // TODO: Mise à jour du statut hors ligne
        // C'est ici que tu mettras le code pour UPDATE users SET is_online = FALSE, socket_id = NULL
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

// --- API ROUTES ---

// 1. AUTH & USERS

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Fix for registration error: ensuring tag uniqueness might be needed here, 
        // but for now, we rely on the DB UNIQUE constraint (username, tag).
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
        // Improved error message logic is highly recommended here, but keeping original for now
        res.status(400).json({ error: "Erreur inscription (Email déjà pris ?)" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(400).json({ error: "Identifiants invalides" });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        // Remove password hash before sending
        delete user.password_hash;
        
        res.json({ user, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// NOUVELLE ROUTE (1/2) : Récupère tous les utilisateurs en ligne (DOIT ÊTRE EN PREMIER)
// CORRECTION DE L'ERREUR UUID: "online" n'est plus interprété comme un ID
app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        // Ajout de is_online dans la sélection
        const result = await pool.query('SELECT id, username, tag, email, is_online FROM users WHERE is_online = TRUE');
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur lors de la récupération des utilisateurs en ligne:", err);
        res.status(500).json({ error: err.message });
    }
});


// ROUTE EXISTANTE (2/2) : Récupère un utilisateur par ID
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        // Ajout de is_online dans la sélection
        const result = await pool.query('SELECT id, username, tag, email, is_online FROM users WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// NOUVELLE ROUTE (3/3) : Récupère la liste des amis acceptés (CORRECTION ERREUR 404 /contacts)
app.get('/api/contacts', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT 
                u.id, u.username, u.tag, u.email, u.is_online,
                fr.status AS friend_status,
                c.id AS conversation_id
            FROM friend_requests fr
            -- Joindre l'autre utilisateur de la demande
            JOIN users u ON (CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END) = u.id
            -- Joindre la conversation privée
            LEFT JOIN participants p1 ON p1.user_id = fr.sender_id AND p1.conversation_id IN (
                SELECT p2.conversation_id FROM participants p2 WHERE p2.user_id = fr.receiver_id
            )
            LEFT JOIN conversations c ON c.id = p1.conversation_id AND c.is_group = FALSE
            
            WHERE (fr.sender_id = $1 OR fr.receiver_id = $1) AND fr.status = 'accepted'
        `;
        
        const result = await pool.query(query, [userId]);
        
        // Renvoyer la liste complète des amis (contacts)
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur lors de la récupération des contacts:", err);
        res.status(500).json({ error: "Erreur serveur interne lors du chargement des contacts." });
    }
});


// 2. CONVERSATIONS
app.get('/api/conversations', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
        // Complex query to get conversations, last message, and handle soft delete
        // In a real app, this might be split or optimized with a view
        const query = `
            SELECT c.*, 
                   p.last_deleted_at,
                   (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
                   (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
                   (SELECT deleted_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_deleted
            FROM conversations c
            JOIN participants p ON c.id = p.conversation_id
            WHERE p.user_id = $1
            ORDER BY last_message_time DESC NULLS LAST
        `;
        const result = await pool.query(query, [userId]);
        
        // Filter Soft Delete logic in JS for simplicity (or could be in WHERE clause)
        const enriched = result.rows.filter(row => {
            if (!row.last_message_time) return true; // Keep empty convs
            if (!row.last_deleted_at) return true; // Never deleted
            return new Date(row.last_message_time) > new Date(row.last_deleted_at); // New message arrived
        }).map(row => ({
            id: row.id,
            name: row.name,
            is_group: row.is_group,
            created_at: row.created_at,
            last_message: row.last_message_deleted ? "🚫 Message supprimé" : (row.last_message_content || "Nouvelle discussion"),
            last_message_at: row.last_message_time || row.created_at
        }));

        res.json(enriched);
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

app.get('/api/conversations/:id/other', authenticateToken, async (req, res) => {
    try {
        // Ajout de is_online dans la sélection
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.email, u.is_online
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

        // Reset soft delete for everyone in conversation
        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        // Get sender info
        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [req.user.id]);
        const sender = userRes.rows[0];
        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}` };

        // Socket Broadcast
        io.to(conversation_id).emit('new_message', fullMsg);
        
        res.json(fullMsg);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/messages/:id', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const result = await pool.query(
            'UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [content, req.params.id]
        );
        const msg = result.rows[0];
        // Get sender info for consistency
        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [msg.sender_id]);
        const sender = userRes.rows[0];
        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}` };

        io.to(msg.conversation_id).emit('message_update', fullMsg);
        res.json(fullMsg);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE messages SET deleted_at = NOW() WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        const msg = result.rows[0];
        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [msg.sender_id]);
        const sender = userRes.rows[0];
        const fullMsg = { ...msg, sender_username: `${sender.username}#${sender.tag}` };

        io.to(msg.conversation_id).emit('message_update', fullMsg);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. FRIEND REQUESTS
app.post('/api/friend_requests', authenticateToken, async (req, res) => {
    const { targetIdentifier } = req.body; // "Name#1234"
    const parts = targetIdentifier.split('#');
    if (parts.length !== 2) return res.status(400).json({ error: "Format Nom#1234 requis" });

    try {
        const userRes = await pool.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND tag = $2', 
            [parts[0].trim(), parts[1].trim()]
        );
        const targetUser = userRes.rows[0];
        
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });
        if (targetUser.id === req.user.id) return res.status(400).json({ error: "Impossible de s'ajouter soi-même" });

        // Check existing
        const existing = await pool.query(
            'SELECT * FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)',
            [req.user.id, targetUser.id]
        );

        if (existing.rows.length > 0) {
            const reqData = existing.rows.find(r => r.status === 'pending');
            if (reqData) return res.status(400).json({ error: "Demande déjà en attente" });
            
            const accepted = existing.rows.find(r => r.status === 'accepted');
            if (accepted) return res.status(400).json({ error: "Vous êtes déjà amis" });
        }

        // Insert
        const newReq = await pool.query(
            'INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2) RETURNING *',
            [req.user.id, targetUser.id]
        );

        io.to(`user:${targetUser.id}`).emit('friend_request', newReq.rows[0]);
        res.json({ success: true });

    } catch (err) {
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
    const { status } = req.body; // 'accepted' or 'rejected'
    try {
        const result = await pool.query(
            'UPDATE friend_requests SET status = $1 WHERE id = $2 RETURNING *',
            [status, req.params.id]
        );
        const request = result.rows[0];
        
        if (status === 'accepted') {
            // Create Conversation
            const convRes = await pool.query('INSERT INTO conversations (is_group) VALUES (false) RETURNING id');
            const convId = convRes.rows[0].id;
            
            // Add Participants
            await pool.query('INSERT INTO participants (user_id, conversation_id) VALUES ($1, $2), ($3, $2)', [request.sender_id, convId, request.receiver_id]);
            
            // System Message
            await pool.query('INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)', [convId, request.receiver_id, '👋 Ami accepté !']);

            res.json({ success: true, conversationId: convId });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Database URL: ${connectionString}`);
});
