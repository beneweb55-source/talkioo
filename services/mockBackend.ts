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
// Simulates WebSockets for a serverless environment
const channel = new BroadcastChannel('talkio_realtime_channel');

type EventType = 
    | { type: 'NEW_MESSAGE', payload: Message }
    | { type: 'MESSAGE_UPDATE', payload: Message } // Covers Edit and Delete
    | { type: 'FRIEND_REQUEST', payload: FriendRequest }
    | { type: 'REQUEST_RESPONSE', payload: { requestId: string, status: string, conversationId?: string } }
    | { type: 'CONVERSATION_UPDATED', payload: { conversationId: string } };

const listeners: { [key: string]: Function[] } = {
    messages: [],
    requests: [],
    conversations: []
};

channel.onmessage = (event) => {
    const data = event.data as EventType;
    if (data.type === 'NEW_MESSAGE') {
        listeners.messages.forEach(cb => cb(data.payload));
        listeners.conversations.forEach(cb => cb()); 
    } else if (data.type === 'MESSAGE_UPDATE') {
        listeners.messages.forEach(cb => cb(data.payload));
        listeners.conversations.forEach(cb => cb());
    } else if (data.type === 'FRIEND_REQUEST') {
        listeners.requests.forEach(cb => cb());
    } else if (data.type === 'REQUEST_RESPONSE') {
        listeners.requests.forEach(cb => cb());
        listeners.conversations.forEach(cb => cb());
    } else if (data.type === 'CONVERSATION_UPDATED') {
        listeners.conversations.forEach(cb => cb());
    }
};

// --- DATA INITIALIZATION ---
let USERS: User[] = [];
let CONVERSATIONS: Conversation[] = [];
let PARTICIPANTS: Participant[] = [];
let MESSAGES: Message[] = [];
let FRIEND_REQUESTS: FriendRequest[] = [];

// --- AUTH SERVICES ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  USERS = loadFromStorage(STORAGE_KEYS.USERS, []); 

  if (USERS.find(u => u.email.toLowerCase() === email.trim().toLowerCase())) {
    throw new Error("Cet email est déjà utilisé.");
  }

  // Generate Random Tag (1000-9999)
  let tag = Math.floor(1000 + Math.random() * 9000).toString();
  let attempts = 0;
  while (USERS.find(u => u.username.toLowerCase() === username.toLowerCase() && u.tag === tag) && attempts < 10) {
      tag = Math.floor(1000 + Math.random() * 9000).toString();
      attempts++;
  }

  const newUser: User = {
    id: Date.now().toString(), 
    username: username.trim(),
    tag,
    email: email.trim(),
    created_at: new Date().toISOString()
  };
  
  USERS.push(newUser);
  saveToStorage(STORAGE_KEYS.USERS, USERS);
  
  return { user: newUser, token: `mock_token_${newUser.id}` };
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 400));
  USERS = loadFromStorage(STORAGE_KEYS.USERS, []);
  
  const user = USERS.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) throw new Error("Identifiants incorrects.");
  
  return { user, token: `mock_token_${user.id}` };
};

export const getUserByIdAPI = async (id: string): Promise<User | undefined> => {
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);
    return USERS.find(u => u.id === id);
};

// --- CONVERSATION SERVICES ---

export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => {
  CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, []);
  PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, []);
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, []);

  const myParticipations = PARTICIPANTS.filter(p => p.user_id === userId);
  const myConvIds = myParticipations.map(p => p.conversation_id);
  
  let conversations = CONVERSATIONS.filter(c => myConvIds.includes(c.id));

  // Enrich with last message
  let enriched = conversations.map(c => {
    const msgs = MESSAGES
        .filter(m => m.conversation_id === c.id && !m.deleted_at) // Don't show deleted messages as last message preview if possible, or handle text
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    // Fallback if all messages are deleted
    const allMsgs = MESSAGES
        .filter(m => m.conversation_id === c.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const latest = allMsgs[0];
    let preview = "Nouvelle discussion";
    if (latest) {
        preview = latest.deleted_at ? "🚫 Message supprimé" : latest.content;
    }
        
    return {
      ...c,
      last_message: preview,
      last_message_at: latest?.created_at || c.created_at
    };
  });

  // Soft Delete Filter
  enriched = enriched.filter(c => {
      const p = myParticipations.find(mp => mp.conversation_id === c.id);
      if (!p || !p.last_deleted_at) return true;
      return new Date(c.last_message_at!).getTime() > new Date(p.last_deleted_at).getTime();
  });

  return enriched.sort((a, b) => new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime());
};

export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => {
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, []);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);

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
  MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, []);
  USERS = loadFromStorage(STORAGE_KEYS.USERS, []);
  
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
  
  channel.postMessage({ type: 'NEW_MESSAGE', payload: newMessage });
  channel.postMessage({ type: 'CONVERSATION_UPDATED', payload: { conversationId } });
  
  listeners.messages.forEach(cb => cb(newMessage));
  listeners.conversations.forEach(cb => cb());
  
  return newMessage;
};

// --- NEW: MESSAGE EDITING & DELETION ---

export const editMessageAPI = async (messageId: string, newContent: string): Promise<Message> => {
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, []);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);
    
    const msgIndex = MESSAGES.findIndex(m => m.id === messageId);
    if (msgIndex === -1) throw new Error("Message introuvable");

    const updatedMsg = {
        ...MESSAGES[msgIndex],
        content: newContent,
        updated_at: new Date().toISOString()
    };

    MESSAGES[msgIndex] = updatedMsg;
    saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    // Populate sender for UI consistency
    const sender = USERS.find(u => u.id === updatedMsg.sender_id);
    const completeMsg = {
        ...updatedMsg,
        sender_username: sender ? `${sender.username}#${sender.tag}` : 'Inconnu'
    };

    channel.postMessage({ type: 'MESSAGE_UPDATE', payload: completeMsg });
    listeners.messages.forEach(cb => cb(completeMsg));
    
    return completeMsg;
};

export const deleteMessageAPI = async (messageId: string): Promise<boolean> => {
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, []);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);

    const msgIndex = MESSAGES.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return false;

    const updatedMsg = {
        ...MESSAGES[msgIndex],
        deleted_at: new Date().toISOString()
    };

    MESSAGES[msgIndex] = updatedMsg;
    saveToStorage(STORAGE_KEYS.MESSAGES, MESSAGES);

    const sender = USERS.find(u => u.id === updatedMsg.sender_id);
    const completeMsg = {
        ...updatedMsg,
        sender_username: sender ? `${sender.username}#${sender.tag}` : 'Inconnu'
    };

    channel.postMessage({ type: 'MESSAGE_UPDATE', payload: completeMsg });
    channel.postMessage({ type: 'CONVERSATION_UPDATED', payload: { conversationId: updatedMsg.conversation_id } });

    listeners.messages.forEach(cb => cb(completeMsg));
    listeners.conversations.forEach(cb => cb());

    return true;
};

export const deleteConversationAPI = async (conversationId: string, userId: string): Promise<boolean> => {
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, []);
    
    let found = false;
    PARTICIPANTS = PARTICIPANTS.map(p => {
        if (p.conversation_id === conversationId && p.user_id === userId) {
            found = true;
            return { ...p, last_deleted_at: new Date().toISOString() };
        }
        return p;
    });
    
    if (!found) return false;

    saveToStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
    listeners.conversations.forEach(cb => cb());
    return true;
};

export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => {
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, []);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);

    const otherP = PARTICIPANTS.find(p => p.conversation_id === conversationId && p.user_id !== currentUserId);
    if (!otherP) return undefined;
    return USERS.find(u => u.id === otherP.user_id);
};

// --- FRIEND REQUEST LOGIC ---

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, []);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, []);

    const parts = targetIdentifier.split('#');
    if (parts.length !== 2) throw new Error("Format invalide. Utilisez 'Nom#1234'");
    
    const username = parts[0].trim();
    const tag = parts[1].trim();

    const targetUser = USERS.find(u => 
        u.username.toLowerCase() === username.toLowerCase() && 
        u.tag === tag
    );
    
    if (!targetUser) {
        throw new Error(`Utilisateur '${username}#${tag}' introuvable.`);
    }
    
    if (targetUser.id === currentUserId) throw new Error("Vous ne pouvez pas vous ajouter vous-même.");

    const existingReq = FRIEND_REQUESTS.find(
        r => (r.sender_id === currentUserId && r.receiver_id === targetUser.id) || 
             (r.sender_id === targetUser.id && r.receiver_id === currentUserId)
    );

    const myConvs = PARTICIPANTS.filter(p => p.user_id === currentUserId).map(p => p.conversation_id);
    const commonConv = PARTICIPANTS.find(p => p.user_id === targetUser.id && myConvs.includes(p.conversation_id));

    if (commonConv) {
        const myPart = PARTICIPANTS.find(p => p.user_id === currentUserId && p.conversation_id === commonConv.conversation_id);
        
        if (myPart && myPart.last_deleted_at) {
            myPart.last_deleted_at = null;
            saveToStorage(STORAGE_KEYS.PARTICIPANTS, PARTICIPANTS);
            
            channel.postMessage({ type: 'CONVERSATION_UPDATED', payload: { conversationId: commonConv.conversation_id } });
            listeners.conversations.forEach(cb => cb());
            throw new Error("Conversation rouverte ! (Vous étiez déjà amis)");
        }

        throw new Error("Vous avez déjà une conversation active avec cette personne.");
    }

    if (existingReq && existingReq.status === 'pending') throw new Error("Une demande est déjà en attente.");

    if (existingReq && existingReq.status === 'accepted') {
         await createConversationInternal(currentUserId, targetUser.id);
         channel.postMessage({ type: 'CONVERSATION_UPDATED', payload: { conversationId: 'restored' } });
         listeners.conversations.forEach(cb => cb());
         throw new Error("Conversation rouverte !");
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

    channel.postMessage({ type: 'FRIEND_REQUEST', payload: newRequest });
    listeners.requests.forEach(cb => cb());

    return true;
};

export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => {
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, []);
    USERS = loadFromStorage(STORAGE_KEYS.USERS, []);

    const requests = FRIEND_REQUESTS.filter(r => r.receiver_id === userId && r.status === 'pending');
    
    return requests.map(r => ({
        ...r,
        sender: USERS.find(u => u.id === r.sender_id)
    }));
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    await new Promise(resolve => setTimeout(resolve, 400));
    
    FRIEND_REQUESTS = loadFromStorage(STORAGE_KEYS.FRIEND_REQUESTS, []);
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
    listeners.conversations.forEach(cb => cb());

    return newConv;
};

const createConversationInternal = async (user1Id: string, user2Id: string): Promise<Conversation> => {
    CONVERSATIONS = loadFromStorage(STORAGE_KEYS.CONVERSATIONS, []);
    PARTICIPANTS = loadFromStorage(STORAGE_KEYS.PARTICIPANTS, []);
    MESSAGES = loadFromStorage(STORAGE_KEYS.MESSAGES, []);

    const newId = Date.now().toString();
    const newConv: Conversation = {
        id: newId,
        name: null,
        is_group: false,
        created_at: new Date().toISOString(),
        last_message: "👋 Discussion commencée",
        last_message_at: new Date().toISOString()
    };

    CONVERSATIONS.push(newConv);
    PARTICIPANTS.push({ user_id: user1Id, conversation_id: newId, joined_at: new Date().toISOString(), last_deleted_at: null });
    PARTICIPANTS.push({ user_id: user2Id, conversation_id: newId, joined_at: new Date().toISOString(), last_deleted_at: null });
    
    const sysMsg: Message = {
        id: Date.now().toString() + "_sys",
        conversation_id: newId,
        sender_id: user1Id, 
        content: "👋 Demande acceptée ! Vous pouvez discuter.",
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
        // Only pass if it belongs to this conversation
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
    const handler = () => onNewRequest();
    listeners.requests.push(handler);
    return () => {
        listeners.requests = listeners.requests.filter(cb => cb !== handler);
    };
};

export const subscribeToConversationsList = (onUpdate: () => void) => {
    const handler = () => onUpdate();
    listeners.conversations.push(handler);
    return () => {
        listeners.conversations = listeners.conversations.filter(cb => cb !== handler);
    };
};