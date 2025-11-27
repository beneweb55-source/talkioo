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
        origin: "*", // Allow all origins for MVP
        methods: ["GET", "POST"]
    }
});

io.on('connection', async (socket) => {
    // Assumes the Frontend sends the userId in the handshake query
    const userId = socket.handshake.query.userId;
    console.log('User connected:', socket.id, 'User ID:', userId);

    if (userId) {
        try {
            // METTRE À JOUR LE STATUT EN LIGNE
            await pool.query(
                'UPDATE users SET is_online = TRUE, socket_id = $1 WHERE id = $2',
                [socket.id, userId]
            );
            
            // Notifier le changement de statut à tous
            io.emit('user_status', { userId: userId, isOnline: true }); 
            
            socket.join(`user:${userId}`);
        } catch (err) {
            console.error("Erreur mise à jour connexion statut:", err.message);
        }
    }

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
    });
    
    socket.on('join_user_channel', (userId) => {
        socket.join(`user:${userId}`);
    });

    // Typing Indicators (Ajouté pour compatibilité avec le frontend existant)
    socket.on('typing_start', ({ conversationId }) => {
        if (!userId) return;
        socket.to(conversationId).emit('typing_update', { conversationId, userId: userId, isTyping: true });
    });
  
    socket.on('typing_stop', ({ conversationId }) => {
        if (!userId) return;
        socket.to(conversationId).emit('typing_update', { conversationId, userId: userId, isTyping: false });
    });

    socket.on('disconnect', async () => { 
        console.log('User disconnected:', socket.id);
        
        try {
            // Retrouver l'ID utilisateur à partir de l'ID Socket
            const userRes = await pool.query('SELECT id FROM users WHERE socket_id = $1', [socket.id]);
            const disconnectedUserId = userRes.rows[0]?.id;

            if (disconnectedUserId) {
                // METTRE À JOUR LE STATUT HORS LIGNE
                await pool.query(
                    'UPDATE users SET is_online = FALSE, socket_id = NULL WHERE id = $1',
                    [disconnectedUserId]
                );
                // Notifier le changement de statut à tous
                io.emit('user_status', { userId: disconnectedUserId, isOnline: false });
            }
        } catch (err) {
            console.error("Erreur mise à jour déconnexion statut:", err.message);
        }
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

app.get('/', (req, res) => res.send("Talkio Backend is Running 🚀"));

// 1. AUTH & USERS
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
    email = email.toLowerCase().trim();

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


// Récupère tous les utilisateurs en ligne
app.get('/api/users/online', authenticateToken, async (req, res) => {
    try {
        // Retourne la liste des IDs pour le Set() coté client
        const result = await pool.query('SELECT id FROM users WHERE is_online = TRUE');
        res.json(result.rows.map(u => u.id));
    } catch (err) {
        console.error("Erreur lors de la récupération des utilisateurs en ligne:", err);
        res.status(500).json({ error: err.message });
    }
});


// Récupère un utilisateur par ID
app.get('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, tag, email, is_online FROM users WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Récupère la liste des amis acceptés
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
        
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur lors de la récupération des contacts:", err);
        res.status(500).json({ error: "Erreur serveur interne lors du chargement des contacts." });
    }
});


// 2. CONVERSATIONS
// Création d'une conversation (groupe ou chat privé)
app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { name, participantIds } = req.body; 
    const userId = req.user.id;

    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: "Les identifiants des participants sont requis." });
    }

    try {
        const is_group = participantIds.length > 1 || (name && name.length > 0);

        // 1. Créer la conversation
        const convRes = await pool.query(
            'INSERT INTO conversations (name, is_group) VALUES ($1, $2) RETURNING id',
            [is_group ? name : null, is_group]
        );
        const conversationId = convRes.rows[0].id;

        // 2. Préparer les valeurs pour les participants
        const allParticipants = [...new Set([...participantIds, userId])];
        
        let participantValues = [];
        let participantPlaceholders = [];
        
        for (let i = 0; i < allParticipants.length; i++) {
            participantPlaceholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
            participantValues.push(allParticipants[i], conversationId);
        }

        // 3. Ajouter les participants
        const participantsQuery = `
            INSERT INTO participants (user_id, conversation_id) 
            VALUES ${participantPlaceholders.join(', ')} 
            RETURNING *
        `;
        
        await pool.query(participantsQuery, participantValues);
        
        // 4. Envoyer un message système
        await pool.query(
             'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3)',
             [conversationId, userId, is_group ? `👋 Le groupe "${name}" a été créé !` : '👋 Nouvelle discussion privée.']
        );

        // Notifier les participants
        allParticipants.forEach(uid => {
            io.to(`user:${uid}`).emit('conversation_added', { conversationId });
        });

        res.status(201).json({ conversationId, name: is_group ? name : null, is_group, participants: allParticipants });

    } catch (err) {
        console.error("Erreur lors de la création de la conversation:", err);
        res.status(500).json({ error: "Erreur serveur interne lors de la création." });
    }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    try {
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

// Marquer tous les messages d'une conversation comme lus
app.post('/api/conversations/:id/read', authenticateToken, async (req, res) => {
    const conversationId = req.params.id;
    const userId = req.user.id;
    
    try {
        // 1. Trouver tous les messages dans la conversation que cet utilisateur n'a PAS encore lus.
        const messagesToReadRes = await pool.query(`
            SELECT m.id 
            FROM messages m
            LEFT JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = $1
            WHERE m.conversation_id = $2 AND m.sender_id != $1 AND mr.message_id IS NULL
            ORDER BY m.created_at DESC
        `, [userId, conversationId]);

        const messageIds = messagesToReadRes.rows.map(row => row.id);

        if (messageIds.length > 0) {
            // 2. Préparer l'insertion des enregistrements de lecture
            const readValues = [];
            const readPlaceholders = [];
            for (let i = 0; i < messageIds.length; i++) {
                readPlaceholders.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
                readValues.push(messageIds[i], userId);
            }

            const readQuery = `
                INSERT INTO message_reads (message_id, user_id) 
                VALUES ${readPlaceholders.join(', ')}
                ON CONFLICT (message_id, user_id) DO NOTHING
            `;

            await pool.query(readQuery, readValues);

            // 3. Notifier TOUS les clients de cette conversation que le statut de lecture a changé
            io.to(conversationId).emit('READ_RECEIPT_UPDATE', { conversationId: conversationId, readerId: userId });
        }
        
        res.json({ success: true, count: messageIds.length });

    } catch (err) {
        console.error("Erreur lors de la mise à jour du statut de lecture:", err);
        res.status(500).json({ error: "Erreur serveur lors de la mise à jour de la lecture." });
    }
});

app.get('/api/conversations/:id/other', authenticateToken, async (req, res) => {
    try {
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
    const conversationId = req.params.id;
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT 
                m.*, 
                u.username, 
                u.tag,
                -- Statut de lecture : Compte combien de personnes AUTRES que l'utilisateur courant ont lu
                (
                    SELECT COUNT(*) 
                    FROM message_reads mr 
                    WHERE mr.message_id = m.id AND mr.user_id != $2
                ) AS read_count,
                -- Infos du message répondu
                m2.content AS replied_to_content,
                u2.username AS replied_to_username,
                u2.tag AS replied_to_tag
            FROM messages m
            LEFT JOIN users u ON m.sender_id = u.id
            LEFT JOIN messages m2 ON m.replied_to_message_id = m2.id
            LEFT JOIN users u2 ON m2.sender_id = u2.id
            WHERE m.conversation_id = $1
            ORDER BY m.created_at ASC
        `, [conversationId, userId]);
        
        const messages = result.rows.map(m => ({
            ...m,
            sender_username: m.username ? `${m.username}#${m.tag}` : 'Inconnu',
            read_count: parseInt(m.read_count),
            reply: m.replied_to_message_id ? {
                id: m.replied_to_message_id,
                content: m.replied_to_content || 'Message original supprimé', 
                sender: m.replied_to_username ? `${m.replied_to_username}#${m.replied_to_tag}` : 'Utilisateur inconnu'
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

        // 1. Marquer le message comme lu par l'expéditeur (soi-même)
        await pool.query(
            'INSERT INTO message_reads (message_id, user_id) VALUES ($1, $2) ON CONFLICT (message_id, user_id) DO NOTHING',
            [msg.id, senderId]
        );

        // 2. Reset soft delete for everyone in conversation
        await pool.query('UPDATE participants SET last_deleted_at = NULL WHERE conversation_id = $1', [conversation_id]);

        // 3. Get sender info
        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [senderId]);
        const sender = userRes.rows[0];
        
        // 4. Récupérer les infos de réponse pour le broadcast
        let replyData = null;
        if (msg.replied_to_message_id) {
             const replyRes = await pool.query(`
                    SELECT m2.content, u2.username, u2.tag 
                    FROM messages m2
                    LEFT JOIN users u2 ON m2.sender_id = u2.id
                    WHERE m2.id = $1
                `, [msg.replied_to_message_id]);
            
            const r = replyRes.rows[0];
            if (r) {
                replyData = {
                    id: msg.replied_to_message_id,
                    content: r.content || 'Message original supprimé',
                    sender: r.username ? `${r.username}#${r.tag}` : 'Utilisateur inconnu'
                };
            }
        }

        const fullMsg = { 
            ...msg, 
            sender_username: `${sender.username}#${sender.tag}`, 
            read_count: 0, 
            reply: replyData
        }; 

        // 5. Socket Broadcast
        io.to(conversation_id).emit('new_message', fullMsg);
        
        // Also notify list updates
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
        const result = await pool.query(
            'UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [content, req.params.id]
        );
        const msg = result.rows[0];
        
        const userRes = await pool.query('SELECT username, tag FROM users WHERE id = $1', [msg.sender_id]);
        const sender = userRes.rows[0];
        const readCountRes = await pool.query('SELECT COUNT(*) FROM message_reads WHERE message_id = $1 AND user_id != $2', [msg.id, req.user.id]);
        
        let replyData = null;
        if (msg.replied_to_message_id) {
             const replyRes = await pool.query(`
                    SELECT m2.content, u2.username, u2.tag 
                    FROM messages m2
                    LEFT JOIN users u2 ON m2.sender_id = u2.id
                    WHERE m2.id = $1
                `, [msg.replied_to_message_id]);
            
            const r = replyRes.rows[0];
            if (r) {
                replyData = {
                    id: msg.replied_to_message_id,
                    content: r.content || 'Message original supprimé',
                    sender: r.username ? `${r.username}#${r.tag}` : 'Utilisateur inconnu'
                };
            }
        }
        
        const fullMsg = { 
            ...msg, 
            sender_username: `${sender.username}#${sender.tag}`,
            read_count: parseInt(readCountRes.rows[0].count),
            reply: replyData
        };

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
    if (!targetIdentifier) return res.status(400).json({ error: "Identifiant requis" });

    // --- CORRECTION APPLIQUÉE ICI (Split plus robuste) ---
    const lastHashIndex = targetIdentifier.lastIndexOf('#');
    if (lastHashIndex === -1) return res.status(400).json({ error: "Format Nom#1234 requis" });

    const usernameToSearch = targetIdentifier.substring(0, lastHashIndex).trim();
    const tagToSearch = targetIdentifier.substring(lastHashIndex + 1).trim();
    
    console.log(`[FriendRequest] Recherche: "${usernameToSearch}" #${tagToSearch}`);
    
    try {
        const userRes = await pool.query(
            // On utilise UPPER pour s'assurer que si l'utilisateur est stocké comme 'Meli' ou 'meli',
            // la comparaison fonctionne.
            'SELECT id FROM users WHERE UPPER(username) = UPPER($1) AND tag = $2', 
            [usernameToSearch, tagToSearch] 
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
        console.error("Erreur complète du serveur lors de la demande d'ami:", err);
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


server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Database URL: ${connectionString}`);
});