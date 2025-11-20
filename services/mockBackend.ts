import { User, Conversation, Message, Participant, AuthResponse, FriendRequest } from '../types';

// --- STORAGE HELPERS ---
const STORAGE_KEYS = {
  USERS: 'talkio_users',
  CONVERSATIONS: 'talkio_conversations',
  PARTICIPANTS: 'talkio_participants',
  MESSAGES: 'talkio_messages',
  FRIEND_REQUESTS: 'talkio_friend_requests'
};

const loadFromStorage = <T>(key: string, defaultData: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultData;
  } catch (e) {
    console.error(`Error loading ${key}`, e);
    return defaultData;
  }
};

const saveToStorage = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Error saving ${key}`, e);
  }
};

// --- REALTIME ENGINE (BroadcastChannel) ---
// Permet à deux onglets du même navigateur de communiquer (ex: Alice dans Tab 1, Bob dans Tab 2)
const channel = new BroadcastChannel('talkio_realtime_channel');

type EventType = 
    | { type: 'NEW_MESSAGE', payload: Message }
    | { type: 'FRIEND_REQUEST', payload: FriendRequest }
    | { type: 'REQUEST_RESPONSE', payload: { requestId: string, status: string, conversationId?: string } };

const listeners: { [key: string]: Function[] } = {
    messages: [],
    requests: []
};

channel.onmessage = (event) => {
    const data = event.data as EventType;
    if (data.type === 'NEW_MESSAGE') {
        listeners.messages.forEach(cb => cb(data.payload));
    } else if (data.type === 'FRIEND_REQUEST') {
        listeners.requests.forEach(cb => cb());
    } else if (data.type === 'REQUEST_RESPONSE') {
        // Refresh general si besoin, ou spécifique
        listeners.requests.forEach(cb => cb());
    }
};

// --- DATA INITIALIZATION ---
// Structure relationnelle type SQL simulée en objets JSON
let USERS = loadFromStorage<User[]>(STORAGE_KEYS.USERS, [
  { id: '1', username: 'Alice', tag: '1234', email: 'alice@test.com', created_at: new Date().toISOString() },
  { id: '2', username: 'Bob', tag: '5678', email: 'bob@test.com', created_at: new Date().toISOString() }
]);

let CONVERSATIONS = loadFromStorage<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);
let PARTICIPANTS = loadFromStorage<Participant[]>(STORAGE_KEYS.PARTICIPANTS, []);
let MESSAGES = loadFromStorage<Message[]>(STORAGE_KEYS.MESSAGES, []);
let FRIEND_REQUESTS = loadFromStorage<FriendRequest[]>(STORAGE_KEYS.FRIEND_REQUESTS, []);

// --- AUTH SERVICES ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

  if (USERS.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("Cet email est déjà utilisé.");
  }

  const newUser: User = {
    id: Date.now().toString(), // Simple ID generation
    username,
    tag: Math.floor(1000 + Math.random() * 9000).toString(),
    email,
    created_at: new Date().toISOString()
  };
  
  USERS.push(newUser);
  saveToStorage(STORAGE_KEYS.USERS, USERS);
  
  return { user: newUser, token: `mock_token_${newUser.id}` };
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 400));
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);
  
  const user = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error("Identifiants incorrects.");
  
  // Note: On accepte n'importe quel mot de passe pour la démo locale
  return { user, token: `mock_token_${user.id}` };
};

export const getUserByIdAPI = async (id: string): Promise<User | undefined> => {
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);
    return USERS.find(u => u.id === id);
};

// --- CONVERSATION SERVICES ---

export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Recharger les données pour être à jour
  CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
  PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

  // JOIN implicite: Participants -> Conversations
  const userConvIds = PARTICIPANTS
    .filter(p => p.user_id === userId)
    .map(p => p.conversation_id);
    
  const conversations = CONVERSATIONS.filter(c => userConvIds.includes(c.id));

  // Enrichir avec le dernier message
  return conversations.map(c => {
    const msgs = MESSAGES
        .filter(m => m.conversation_id === c.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
    return {
      ...c,
      last_message: msgs[0]?.content || "Nouvelle discussion",
      last_message_at: msgs[0]?.created_at || c.created_at
    };
  }).sort((a, b) => new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime());
};

export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

    const messages = MESSAGES
        .filter(m => m.conversation_id === conversationId)
        .map(m => {
            const sender = USERS.find(u => u.id === m.sender_id);
            return { 
                ...m, 
                sender_username: sender ? `${sender.username}#${sender.tag}` : 'Inconnu' 
            };
        })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    
    return messages;
};

export const sendMessageAPI = async (conversationId: string, userId: string, content: string): Promise<Message> => {
  await new Promise(resolve => setTimeout(resolve, 100)); 
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

  const sender = USERS.find(u => u.id === userId);
  const newMessage: Message = {
    id: Date.now().toString() + Math.random().toString().slice(2,5),
    conversation_id: conversationId,
    sender_id: userId,
    content,
    created_at: new Date().toISOString(),
    sender_username: sender ? `${sender.username}#${sender.tag}` : 'Moi'
  };
  
  MESSAGES.push(newMessage);
  saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
  
  // Notifier via BroadcastChannel pour les autres onglets
  channel.postMessage({ type: 'NEW_MESSAGE', payload: newMessage });
  
  // Notifier localement
  listeners.messages.forEach(cb => cb(newMessage));
  
  return newMessage;
};

export const deleteConversationAPI = async (conversationId: string): Promise<boolean> => {
    CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    // Cascade delete simulation
    PARTICIPANTS = PARTICIPANTS.filter(p => p.conversation_id !== conversationId);
    MESSAGES = MESSAGES.filter(m => m.conversation_id !== conversationId);
    CONVERSATIONS = CONVERSATIONS.filter(c => c.id !== conversationId);
    
    saveToStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    saveToStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
    
    return true;
};

export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => {
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

    const otherP = PARTICIPANTS.find(p => p.conversation_id === conversationId && p.user_id !== currentUserId);
    if (!otherP) return undefined;
    return USERS.find(u => u.id === otherP.user_id);
};

// --- FRIEND REQUEST LOGIC ---

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Refresh Data
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);

    // Parse: "Nom#1234"
    const parts = targetIdentifier.split('#');
    if (parts.length !== 2) throw new Error("Format invalide. Utilisez 'Nom#1234'");
    
    const username = parts[0].trim();
    const tag = parts[1].trim();

    // Recherche insensible à la casse pour le nom, mais exacte pour le tag
    const targetUser = USERS.find(u => 
        u.username.toLowerCase() === username.toLowerCase() && 
        u.tag === tag
    );
    
    if (!targetUser) {
        throw new Error(`Utilisateur '${username}#${tag}' introuvable.`);
    }
    
    if (targetUser.id === currentUserId) throw new Error("Vous ne pouvez pas vous ajouter vous-même.");

    // Vérifier existence
    const existingReq = FRIEND_REQUESTS.find(
        r => (r.sender_id === currentUserId && r.receiver_id === targetUser.id) || 
             (r.sender_id === targetUser.id && r.receiver_id === currentUserId)
    );

    if (existingReq) {
        if (existingReq.status === 'pending') throw new Error("Une demande est déjà en attente.");
        if (existingReq.status === 'accepted') throw new Error("Vous êtes déjà amis.");
    }

    const newRequest: FriendRequest = {
        id: Date.now().toString(),
        sender_id: currentUserId,
        receiver_id: targetUser.id,
        status: 'pending',
        created_at: new Date().toISOString()
    };
    
    FRIEND_REQUESTS.push(newRequest);
    saveToStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);

    // Realtime notify
    channel.postMessage({ type: 'FRIEND_REQUEST', payload: newRequest });

    return true;
};

export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => {
    await new Promise(resolve => setTimeout(resolve, 200));
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

    const requests = FRIEND_REQUESTS.filter(r => r.receiver_id === userId && r.status === 'pending');
    
    return requests.map(r => ({
        ...r,
        sender: USERS.find(u => u.id === r.sender_id)
    }));
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);
    const reqIndex = FRIEND_REQUESTS.findIndex(r => r.id === requestId);
    
    if (reqIndex === -1) throw new Error("Demande introuvable");

    FRIEND_REQUESTS[reqIndex].status = status;
    saveToStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);

    let newConv = null;
    if (status === 'accepted') {
        const req = FRIEND_REQUESTS[reqIndex];
        newConv = await createConversationInternal(req.sender_id, req.receiver_id);
    }
    
    channel.postMessage({ 
        type: 'REQUEST_RESPONSE', 
        payload: { requestId, status, conversationId: newConv?.id } 
    });

    return newConv;
};

const createConversationInternal = async (user1Id: string, user2Id: string): Promise<Conversation> => {
    CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    const newId = Date.now().toString();
    const newConv: Conversation = {
        id: newId,
        name: null,
        is_group: false,
        created_at: new Date().toISOString(),
        last_message: "Vous êtes maintenant amis !",
        last_message_at: new Date().toISOString()
    };

    CONVERSATIONS.push(newConv);
    PARTICIPANTS.push({ user_id: user1Id, conversation_id: newId, joined_at: new Date().toISOString() });
    PARTICIPANTS.push({ user_id: user2Id, conversation_id: newId, joined_at: new Date().toISOString() });
    
    const sysMsg: Message = {
        id: Date.now().toString() + "_sys",
        conversation_id: newId,
        sender_id: user1Id,
        content: "👋 Discussion démarrée.",
        created_at: new Date().toISOString()
    };
    MESSAGES.push(sysMsg);

    saveToStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    saveToStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    return newConv;
};

// --- SUBSCRIPTION HOOKS ---

export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    const handler = (msg: Message) => {
        if (msg.conversation_id === conversationId) {
            onMessage(msg);
        }
    };
    listeners.messages.push(handler);
    return () => {
        listeners.messages = listeners.messages.filter(cb => cb !== handler);
    };
};

export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    const handler = () => {
        // On pourrait filtrer pour savoir si c'est pour cet user, mais pour le mock on refresh tout
        onNewRequest();
    };
    listeners.requests.push(handler);
    return () => {
        listeners.requests = listeners.requests.filter(cb => cb !== handler);
    };
};
