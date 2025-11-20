import { User, Conversation, Message, AuthResponse, FriendRequest, Participant } from '../types';

// --- CONFIGURATION MONGODB ---
const MONGO_URI = "mongodb+srv://tvmystral:Etolefaux2009@cluster0.9fymxal.mongodb.net/?appName=Cluster0";
console.log(`[MongoDB] Initializing connection to: ${MONGO_URI.split('@')[1].split('/')[0]}...`);
console.log("[MongoDB] Connection established via Mock Driver.");

// --- COLLECTIONS (Simulées via LocalStorage pour la persistance) ---
const COLLECTIONS = {
  USERS: 'mongo_users',
  CONVERSATIONS: 'mongo_conversations',
  PARTICIPANTS: 'mongo_participants',
  MESSAGES: 'mongo_messages',
  FRIEND_REQUESTS: 'mongo_friend_requests'
};

// --- HELPER FUNCTIONS ---
const db = {
    collection: <T>(name: string) => {
        const load = (): T[] => {
            const data = localStorage.getItem(name);
            return data ? JSON.parse(data) : [];
        };
        const save = (data: T[]) => {
            localStorage.setItem(name, JSON.stringify(data));
        };
        return {
            find: (predicate?: (item: T) => boolean) => {
                const items = load();
                return predicate ? items.filter(predicate) : items;
            },
            findOne: (predicate: (item: T) => boolean) => {
                const items = load();
                return items.find(predicate);
            },
            insertOne: (item: T) => {
                const items = load();
                items.push(item);
                save(items);
                return item;
            },
            updateOne: (predicate: (item: T) => boolean, updateFn: (item: T) => T) => {
                const items = load();
                const index = items.findIndex(predicate);
                if (index !== -1) {
                    items[index] = updateFn(items[index]);
                    save(items);
                    return items[index];
                }
                return null;
            },
            deleteOne: (predicate: (item: T) => boolean) => {
                let items = load();
                const initLen = items.length;
                items = items.filter(i => !predicate(i));
                save(items);
                return items.length < initLen;
            },
            deleteMany: (predicate: (item: T) => boolean) => {
                let items = load();
                items = items.filter(i => !predicate(i));
                save(items);
            }
        };
    }
};

// --- REALTIME EMULATOR (Change Streams) ---
const listeners: Record<string, Function[]> = {};

const emitChange = (channel: string, data: any) => {
    if (listeners[channel]) {
        listeners[channel].forEach(cb => cb(data));
    }
};

// --- AUTH SERVICES ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
    await new Promise(resolve => setTimeout(resolve, 800)); // Network latency simulation

    const existing = db.collection<User>(COLLECTIONS.USERS).findOne(u => u.email === email);
    if (existing) throw new Error("Cet email est déjà utilisé (MongoDB E11000 duplicate key error)");

    const newUser: User = {
        id: Math.random().toString(36).substring(2, 15), // MongoDB ObjectId simulation
        username,
        tag: Math.floor(1000 + Math.random() * 9000).toString(),
        email,
        created_at: new Date().toISOString()
    };

    db.collection<User>(COLLECTIONS.USERS).insertOne(newUser);

    // Token factice JWT
    return { user: newUser, token: `mongo_jwt_${newUser.id}` };
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
    await new Promise(resolve => setTimeout(resolve, 500));

    const user = db.collection<User>(COLLECTIONS.USERS).findOne(u => u.email === email);
    // Note: Dans un vrai backend, on vérifierait bcrypt.compare(password, user.password_hash)
    if (!user) throw new Error("Utilisateur introuvable");

    return { user, token: `mongo_jwt_${user.id}` };
};

export const getUserByIdAPI = async (id: string): Promise<User | undefined> => {
    return db.collection<User>(COLLECTIONS.USERS).findOne(u => u.id === id);
};

// --- CONVERSATION SERVICES ---

export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => {
    // 1. $lookup equivalent: Join participants to conversations
    const myParticipations = db.collection<Participant>(COLLECTIONS.PARTICIPANTS).find(p => p.user_id === userId);
    const convIds = myParticipations.map(p => p.conversation_id);
    
    const conversations = db.collection<Conversation>(COLLECTIONS.CONVERSATIONS).find(c => convIds.includes(c.id));

    // 2. Populate last message (Aggregate)
    const enriched = conversations.map(c => {
        const msgs = db.collection<Message>(COLLECTIONS.MESSAGES)
            .find(m => m.conversation_id === c.id)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        return {
            ...c,
            last_message: msgs[0]?.content || "Nouvelle discussion",
            last_message_at: msgs[0]?.created_at || c.created_at
        };
    });

    return enriched.sort((a, b) => new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime());
};

export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => {
    const msgs = db.collection<Message>(COLLECTIONS.MESSAGES).find(m => m.conversation_id === conversationId);
    
    // Populate Sender (Join)
    const users = db.collection<User>(COLLECTIONS.USERS).find();
    
    return msgs.map(m => {
        const sender = users.find(u => u.id === m.sender_id);
        return {
            ...m,
            sender_username: sender ? `${sender.username}#${sender.tag}` : 'Inconnu'
        };
    }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
};

export const sendMessageAPI = async (conversationId: string, userId: string, content: string): Promise<Message> => {
    await new Promise(resolve => setTimeout(resolve, 200));

    const sender = db.collection<User>(COLLECTIONS.USERS).findOne(u => u.id === userId);
    
    const newMessage: Message = {
        id: Math.random().toString(36).substring(2, 15),
        conversation_id: conversationId,
        sender_id: userId,
        content,
        created_at: new Date().toISOString(),
        sender_username: sender ? `${sender.username}#${sender.tag}` : 'Moi'
    };

    db.collection<Message>(COLLECTIONS.MESSAGES).insertOne(newMessage);
    
    // Trigger Realtime
    emitChange(`messages:${conversationId}`, newMessage);

    return newMessage;
};

export const deleteConversationAPI = async (conversationId: string): Promise<boolean> => {
    db.collection(COLLECTIONS.CONVERSATIONS).deleteOne((c: any) => c.id === conversationId);
    db.collection(COLLECTIONS.PARTICIPANTS).deleteMany((p: any) => p.conversation_id === conversationId);
    db.collection(COLLECTIONS.MESSAGES).deleteMany((m: any) => m.conversation_id === conversationId);
    return true;
};

// --- FRIEND REQUEST SERVICES ---

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 400));

    const parts = targetIdentifier.split('#');
    if (parts.length !== 2) throw new Error("Format invalide. Utilisez 'Nom#1234'");
    
    const [username, tag] = parts;
    const targetUser = db.collection<User>(COLLECTIONS.USERS).findOne(
        u => u.username.toLowerCase() === username.trim().toLowerCase() && u.tag === tag.trim()
    );

    if (!targetUser) throw new Error("Utilisateur introuvable dans la base MongoDB.");
    if (targetUser.id === currentUserId) throw new Error("Impossible de s'ajouter soi-même.");

    const requests = db.collection<FriendRequest>(COLLECTIONS.FRIEND_REQUESTS).find();
    const existing = requests.find(r => 
        (r.sender_id === currentUserId && r.receiver_id === targetUser.id) ||
        (r.sender_id === targetUser.id && r.receiver_id === currentUserId)
    );

    if (existing) {
        if (existing.status === 'pending') throw new Error("Demande déjà en attente.");
        if (existing.status === 'accepted') throw new Error("Déjà amis.");
    }

    const newReq: FriendRequest = {
        id: Math.random().toString(36).substring(2, 15),
        sender_id: currentUserId,
        receiver_id: targetUser.id,
        status: 'pending',
        created_at: new Date().toISOString()
    };

    db.collection<FriendRequest>(COLLECTIONS.FRIEND_REQUESTS).insertOne(newReq);
    emitChange(`requests:${targetUser.id}`, newReq);
    return true;
};

export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => {
    const reqs = db.collection<FriendRequest>(COLLECTIONS.FRIEND_REQUESTS).find(r => r.receiver_id === userId && r.status === 'pending');
    const users = db.collection<User>(COLLECTIONS.USERS).find();

    return reqs.map(r => ({
        ...r,
        sender: users.find(u => u.id === r.sender_id)
    }));
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    const req = db.collection<FriendRequest>(COLLECTIONS.FRIEND_REQUESTS).updateOne(
        r => r.id === requestId,
        r => ({ ...r, status })
    );

    if (req && status === 'accepted') {
        // Start Transaction: Create Chat + Add Participants
        const newConv: Conversation = {
            id: Math.random().toString(36).substring(2, 15),
            name: null,
            is_group: false,
            created_at: new Date().toISOString()
        };
        
        db.collection<Conversation>(COLLECTIONS.CONVERSATIONS).insertOne(newConv);
        db.collection<Participant>(COLLECTIONS.PARTICIPANTS).insertOne({ user_id: req.sender_id, conversation_id: newConv.id, joined_at: new Date().toISOString() });
        db.collection<Participant>(COLLECTIONS.PARTICIPANTS).insertOne({ user_id: req.receiver_id, conversation_id: newConv.id, joined_at: new Date().toISOString() });
        
        await sendMessageAPI(newConv.id, req.receiver_id, "👋 Discussion ouverte (MongoDB)");
        return newConv;
    }
    return null;
};

export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => {
    const participant = db.collection<Participant>(COLLECTIONS.PARTICIPANTS).findOne(p => p.conversation_id === conversationId && p.user_id !== currentUserId);
    if (participant) {
        return db.collection<User>(COLLECTIONS.USERS).findOne(u => u.id === participant.user_id);
    }
    return undefined;
};

// --- SUBSCRIPTION MOCKS ---

export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    const channel = `messages:${conversationId}`;
    if (!listeners[channel]) listeners[channel] = [];
    listeners[channel].push(onMessage);
    return () => {
        listeners[channel] = listeners[channel].filter(cb => cb !== onMessage);
    };
};

export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    const channel = `requests:${userId}`;
    if (!listeners[channel]) listeners[channel] = [];
    listeners[channel].push(onNewRequest);
    return () => {
        listeners[channel] = listeners[channel].filter(cb => cb !== onNewRequest);
    };
};
