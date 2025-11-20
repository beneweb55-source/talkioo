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

// --- DEFAULT DATA (Used only on first load) ---
const DEFAULT_USERS: User[] = [
  { id: 1, username: 'alice', email: 'alice@test.com', created_at: new Date().toISOString() },
  { id: 2, username: 'bob', email: 'bob@test.com', created_at: new Date().toISOString() },
];

const DEFAULT_CONVERSATIONS: Conversation[] = [
    { id: 1, name: 'Groupe Tech', is_group: true, created_at: new Date().toISOString() }
];

const DEFAULT_PARTICIPANTS: Participant[] = [
    { user_id: 1, conversation_id: 1, joined_at: new Date().toISOString() },
    { user_id: 2, conversation_id: 1, joined_at: new Date().toISOString() }
];

const DEFAULT_MESSAGES: Message[] = [
    { id: 1, conversation_id: 1, sender_id: 1, content: 'Bienvenue sur Talkio (version persistante)!', created_at: new Date().toISOString() }
];

// --- STATE INITIALIZATION ---
let USERS = loadFromStorage<User[]>(STORAGE_KEYS.USERS, DEFAULT_USERS);
let CONVERSATIONS = loadFromStorage<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, DEFAULT_CONVERSATIONS);
let PARTICIPANTS = loadFromStorage<Participant[]>(STORAGE_KEYS.PARTICIPANTS, DEFAULT_PARTICIPANTS);
let MESSAGES = loadFromStorage<Message[]>(STORAGE_KEYS.MESSAGES, DEFAULT_MESSAGES);
let FRIEND_REQUESTS = loadFromStorage<FriendRequest[]>(STORAGE_KEYS.FRIEND_REQUESTS, []);

// --- Event Emitter for Socket Simulation ---
type SocketListener = (message: Message) => void;
const listeners: Record<number, SocketListener[]> = {}; 

export const mockSocket = {
  joinRoom: (conversationId: number, callback: SocketListener) => {
    if (!listeners[conversationId]) {
      listeners[conversationId] = [];
    }
    listeners[conversationId].push(callback);
    return () => {
      listeners[conversationId] = listeners[conversationId].filter(cb => cb !== callback);
    };
  },
  emitNewMessage: (conversationId: number, message: Message) => {
    if (listeners[conversationId]) {
      listeners[conversationId].forEach(cb => cb(message));
    }
  }
};

// --- API Methods ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Reload to ensure fresh state
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

  if (USERS.find(u => u.email === email)) {
    throw new Error("Email déjà utilisé");
  }
  const newUser: User = {
    id: USERS.length > 0 ? Math.max(...USERS.map(u => u.id)) + 1 : 1,
    username,
    email,
    created_at: new Date().toISOString()
  };
  
  USERS.push(newUser);
  saveToStorage(STORAGE_KEYS.USERS, USERS);
  
  return { user: newUser, token: `jwt_mock_token_${newUser.id}` };
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS); // Refresh
  
  const user = USERS.find(u => u.email === email);
  // Pour le mock, on accepte n'importe quel mot de passe si l'email est bon
  if (!user) throw new Error("Utilisateur non trouvé");
  
  return { user, token: `jwt_mock_token_${user.id}` };
};

// Utilisé par AuthContext pour restaurer la session
export const getUserByIdAPI = async (id: number): Promise<User | undefined> => {
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);
    return USERS.find(u => u.id === id);
}

export const getConversationsAPI = async (userId: number): Promise<Conversation[]> => {
  await new Promise(resolve => setTimeout(resolve, 400));
  
  CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
  PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

  const userConversationIds = PARTICIPANTS
    .filter(p => p.user_id === userId)
    .map(p => p.conversation_id);
    
  const conversations = CONVERSATIONS.filter(c => userConversationIds.includes(c.id));

  return conversations.map(c => {
    const msgs = MESSAGES.filter(m => m.conversation_id === c.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return {
      ...c,
      last_message: msgs[0]?.content || "Nouvelle discussion",
      last_message_at: msgs[0]?.created_at || c.created_at
    };
  }).sort((a, b) => new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime());
};

// --- FRIEND REQUEST LOGIC ---

const parseTargetIdentifier = (identifier: string) => {
    const lastHashIndex = identifier.lastIndexOf('#');
    if (lastHashIndex === -1) return null;
    const username = identifier.substring(0, lastHashIndex);
    const idStr = identifier.substring(lastHashIndex + 1);
    const id = parseInt(idStr);
    if (isNaN(id)) return null;
    return { username, id };
};

export const sendFriendRequestAPI = async (currentUserId: number, targetIdentifier: string): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Refresh Data
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);

    const targetData = parseTargetIdentifier(targetIdentifier);
    if (!targetData) throw new Error("Format invalide. Utilisez 'Nom#ID' (ex: alice#1)");

    const targetUser = USERS.find(u => u.id === targetData.id && u.username.toLowerCase() === targetData.username.toLowerCase());
    if (!targetUser) throw new Error("Utilisateur introuvable.");
    if (targetUser.id === currentUserId) throw new Error("Vous ne pouvez pas vous ajouter vous-même.");

    const existingReq = FRIEND_REQUESTS.find(
        r => (r.sender_id === currentUserId && r.receiver_id === targetUser.id) || 
             (r.sender_id === targetUser.id && r.receiver_id === currentUserId)
    );

    if (existingReq) {
        if (existingReq.status === 'pending') throw new Error("Une demande est déjà en attente.");
        if (existingReq.status === 'accepted') throw new Error("Vous êtes déjà amis.");
    }

    // Vérifier chat existant
    const myConvs = PARTICIPANTS.filter(p => p.user_id === currentUserId).map(p => p.conversation_id);
    const targetConvs = PARTICIPANTS.filter(p => p.user_id === targetUser.id).map(p => p.conversation_id);
    const commonConvIds = myConvs.filter(id => targetConvs.includes(id));
    const existingConv = CONVERSATIONS.find(c => commonConvIds.includes(c.id) && !c.is_group);
    
    if (existingConv) throw new Error("Une conversation existe déjà.");

    const newRequest: FriendRequest = {
        id: FRIEND_REQUESTS.length > 0 ? Math.max(...FRIEND_REQUESTS.map(r => r.id)) + 1 : 1,
        sender_id: currentUserId,
        receiver_id: targetUser.id,
        status: 'pending',
        created_at: new Date().toISOString()
    };
    
    FRIEND_REQUESTS.push(newRequest);
    saveToStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);
    return true;
};

export const getIncomingFriendRequestsAPI = async (userId: number): Promise<FriendRequest[]> => {
    await new Promise(resolve => setTimeout(resolve, 300));
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

    const requests = FRIEND_REQUESTS.filter(r => r.receiver_id === userId && r.status === 'pending');
    
    return requests.map(r => ({
        ...r,
        sender: USERS.find(u => u.id === r.sender_id)
    }));
};

export const respondToFriendRequestAPI = async (requestId: number, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);
    
    const reqIndex = FRIEND_REQUESTS.findIndex(r => r.id === requestId);
    if (reqIndex === -1) throw new Error("Demande introuvable");

    FRIEND_REQUESTS[reqIndex].status = status;
    saveToStorage(STORAGE_KEYS.FRIEND_REQUESTS, FRIEND_REQUESTS);

    if (status === 'accepted') {
        const req = FRIEND_REQUESTS[reqIndex];
        return await createConversationInternal(req.sender_id, req.receiver_id);
    }

    return null;
};

const createConversationInternal = async (user1Id: number, user2Id: number): Promise<Conversation> => {
    CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    const newId = CONVERSATIONS.length > 0 ? Math.max(...CONVERSATIONS.map(c => c.id)) + 1 : 1;
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
    
    const sysMsg = {
        id: MESSAGES.length > 0 ? Math.max(...MESSAGES.map(m => m.id)) + 1 : 1,
        conversation_id: newId,
        sender_id: user1Id,
        content: "👋 Discussion démarrée via demande d'ami.",
        created_at: new Date().toISOString()
    };
    MESSAGES.push(sysMsg);

    saveToStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    saveToStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    return newConv;
};

export const createConversationAPI = async (currentUserId: number, targetIdentifier: string): Promise<Conversation> => {
     throw new Error("Veuillez utiliser la demande d'ami pour discuter avec quelqu'un.");
};

export const deleteConversationAPI = async (conversationId: number): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    PARTICIPANTS = PARTICIPANTS.filter(p => p.conversation_id !== conversationId);
    MESSAGES = MESSAGES.filter(m => m.conversation_id !== conversationId);
    CONVERSATIONS = CONVERSATIONS.filter(c => c.id !== conversationId);
    
    saveToStorage(STORAGE_KEYS.CONVERSATIONS, CONVERSATIONS);
    saveToStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
    
    return true;
};

export const getMessagesAPI = async (conversationId: number): Promise<Message[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

  const messages = MESSAGES
    .filter(m => m.conversation_id === conversationId)
    .map(m => {
        const sender = USERS.find(u => u.id === m.sender_id);
        return { ...m, sender_username: sender ? `${sender.username}#${sender.id}` : 'Inconnu' };
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return messages;
};

export const sendMessageAPI = async (conversationId: number, userId: number, content: string): Promise<Message> => {
  await new Promise(resolve => setTimeout(resolve, 200)); 
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
  USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

  const sender = USERS.find(u => u.id === userId);
  const newMessage: Message = {
    id: MESSAGES.length > 0 ? Math.max(...MESSAGES.map(m => m.id)) + 1 : 1,
    conversation_id: conversationId,
    sender_id: userId,
    content,
    created_at: new Date().toISOString(),
    sender_username: sender ? `${sender.username}#${sender.id}` : 'Inconnu'
  };
  
  MESSAGES.push(newMessage);
  saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);
  
  mockSocket.emitNewMessage(conversationId, newMessage);
  
  return newMessage;
};

export const getOtherParticipant = (conversationId: number, currentUserId: number): User | undefined => {
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, USERS);

    const otherParticpant = PARTICIPANTS.find(p => p.conversation_id === conversationId && p.user_id !== currentUserId);
    if (!otherParticpant) return undefined;
    return USERS.find(u => u.id === otherParticpant.user_id);
};