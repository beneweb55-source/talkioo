import { User, Conversation, Message, Participant, AuthResponse } from '../types';

// --- Mock Database State ---
// Initial seed data to simulate a populated database
const MOCK_USERS: User[] = [
  { id: 1, username: 'alice_dev', email: 'alice@example.com', created_at: new Date().toISOString() },
  { id: 2, username: 'bob_manager', email: 'bob@example.com', created_at: new Date().toISOString() },
  { id: 3, username: 'charlie_design', email: 'charlie@example.com', created_at: new Date().toISOString() },
];

let MOCK_CONVERSATIONS: Conversation[] = [
  { id: 1, name: 'Tech Team', is_group: true, created_at: new Date().toISOString() },
  { id: 2, name: null, is_group: false, created_at: new Date().toISOString() }, // Private between Alice and Bob
];

let MOCK_PARTICIPANTS: Participant[] = [
  { user_id: 1, conversation_id: 1, joined_at: new Date().toISOString() },
  { user_id: 2, conversation_id: 1, joined_at: new Date().toISOString() },
  { user_id: 3, conversation_id: 1, joined_at: new Date().toISOString() },
  { user_id: 1, conversation_id: 2, joined_at: new Date().toISOString() },
  { user_id: 2, conversation_id: 2, joined_at: new Date().toISOString() },
];

let MOCK_MESSAGES: Message[] = [
  { id: 1, conversation_id: 1, sender_id: 2, content: 'Hey team, how is the MVP coming along?', created_at: new Date(Date.now() - 100000).toISOString() },
  { id: 2, conversation_id: 1, sender_id: 1, content: 'Almost done with the frontend!', created_at: new Date(Date.now() - 50000).toISOString() },
  { id: 3, conversation_id: 2, sender_id: 2, content: 'Alice, can we talk privately?', created_at: new Date(Date.now() - 200000).toISOString() },
];

// --- Event Emitter for Socket Simulation ---
type SocketListener = (message: Message) => void;
const listeners: Record<number, SocketListener[]> = {}; // conversationId -> listeners

export const mockSocket = {
  // Simulate "join_room"
  joinRoom: (conversationId: number, callback: SocketListener) => {
    if (!listeners[conversationId]) {
      listeners[conversationId] = [];
    }
    listeners[conversationId].push(callback);
    console.log(`[Socket] Joined room ${conversationId}`);
    
    return () => {
      listeners[conversationId] = listeners[conversationId].filter(cb => cb !== callback);
      console.log(`[Socket] Left room ${conversationId}`);
    };
  },
  
  // Simulate server emitting "new_message"
  emitNewMessage: (conversationId: number, message: Message) => {
    if (listeners[conversationId]) {
      listeners[conversationId].forEach(cb => cb(message));
    }
  }
};

// --- API Methods ---

// POST /register
export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network delay
  
  if (MOCK_USERS.find(u => u.email === email)) {
    throw new Error("Email already exists");
  }

  const newUser: User = {
    id: MOCK_USERS.length + 1,
    username,
    email,
    created_at: new Date().toISOString()
  };
  MOCK_USERS.push(newUser);
  
  return { user: newUser, token: `jwt_mock_token_${newUser.id}` };
};

// POST /login
export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
  await new Promise(resolve => setTimeout(resolve, 600));
  
  const user = MOCK_USERS.find(u => u.email === email);
  // In a real app, we would verify password hash here using bcrypt
  if (!user) {
    throw new Error("Identifiants invalides");
  }
  
  return { user, token: `jwt_mock_token_${user.id}` };
};

// GET /conversations (for a specific user)
export const getConversationsAPI = async (userId: number): Promise<Conversation[]> => {
  await new Promise(resolve => setTimeout(resolve, 400));
  
  // SQL: SELECT c.* FROM conversations c JOIN participants p ON p.conversation_id = c.id WHERE p.user_id = $1
  const userConversationIds = MOCK_PARTICIPANTS
    .filter(p => p.user_id === userId)
    .map(p => p.conversation_id);
    
  const conversations = MOCK_CONVERSATIONS.filter(c => userConversationIds.includes(c.id));

  // Enhance with last message (Simulating a complex query)
  return conversations.map(c => {
    const msgs = MOCK_MESSAGES.filter(m => m.conversation_id === c.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return {
      ...c,
      last_message: msgs[0]?.content || "Aucun message",
      last_message_at: msgs[0]?.created_at || c.created_at
    };
  }).sort((a, b) => new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime());
};

// POST /conversations (Start a chat with username#id)
export const createConversationAPI = async (currentUserId: number, targetIdentifier: string): Promise<Conversation> => {
    await new Promise(resolve => setTimeout(resolve, 600));

    const lastHashIndex = targetIdentifier.lastIndexOf('#');
    if (lastHashIndex === -1) {
        throw new Error("Format invalide. Utilisez 'username#id' (ex: alice#1)");
    }

    const targetUsername = targetIdentifier.substring(0, lastHashIndex);
    const targetIdStr = targetIdentifier.substring(lastHashIndex + 1);
    const targetId = parseInt(targetIdStr);

    if (isNaN(targetId)) {
        throw new Error("ID invalide.");
    }

    const targetUser = MOCK_USERS.find(u => u.id === targetId && u.username === targetUsername);

    if (!targetUser) {
        throw new Error("Utilisateur introuvable. Vérifiez le nom et l'ID.");
    }

    if (targetUser.id === currentUserId) {
        throw new Error("Vous ne pouvez pas discuter avec vous-même.");
    }

    // Check if conversation exists
    const myConvs = MOCK_PARTICIPANTS.filter(p => p.user_id === currentUserId).map(p => p.conversation_id);
    const targetConvs = MOCK_PARTICIPANTS.filter(p => p.user_id === targetUser.id).map(p => p.conversation_id);
    const commonConvIds = myConvs.filter(id => targetConvs.includes(id));
    
    // Filter for private chats only (is_group = false)
    const existingConv = MOCK_CONVERSATIONS.find(c => commonConvIds.includes(c.id) && !c.is_group);

    if (existingConv) {
        return existingConv;
    }

    // Create new conversation
    const newId = MOCK_CONVERSATIONS.length > 0 ? Math.max(...MOCK_CONVERSATIONS.map(c => c.id)) + 1 : 1;
    const newConv: Conversation = {
        id: newId,
        name: null,
        is_group: false,
        created_at: new Date().toISOString(),
        last_message: "Nouvelle conversation",
        last_message_at: new Date().toISOString()
    };

    MOCK_CONVERSATIONS.push(newConv);
    MOCK_PARTICIPANTS.push({ user_id: currentUserId, conversation_id: newId, joined_at: new Date().toISOString() });
    MOCK_PARTICIPANTS.push({ user_id: targetUser.id, conversation_id: newId, joined_at: new Date().toISOString() });

    return newConv;
};

// DELETE /conversations/:id
export const deleteConversationAPI = async (conversationId: number): Promise<boolean> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Remove participants (Cascade)
    MOCK_PARTICIPANTS = MOCK_PARTICIPANTS.filter(p => p.conversation_id !== conversationId);
    
    // Remove Messages (Cascade)
    MOCK_MESSAGES = MOCK_MESSAGES.filter(m => m.conversation_id !== conversationId);
    
    // Remove Conversation
    MOCK_CONVERSATIONS = MOCK_CONVERSATIONS.filter(c => c.id !== conversationId);
    
    return true;
};

// GET /conversations/:id/messages
export const getMessagesAPI = async (conversationId: number): Promise<Message[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // SQL: SELECT * FROM messages WHERE conversation_id = $1
  const messages = MOCK_MESSAGES
    .filter(m => m.conversation_id === conversationId)
    .map(m => {
        const sender = MOCK_USERS.find(u => u.id === m.sender_id);
        return { ...m, sender_username: sender ? `${sender.username}#${sender.id}` : 'Inconnu' };
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    
  return messages;
};

// POST /messages (Simulate sending a message via Socket/API)
export const sendMessageAPI = async (conversationId: number, userId: number, content: string): Promise<Message> => {
  await new Promise(resolve => setTimeout(resolve, 200)); // Fast network
  
  const sender = MOCK_USERS.find(u => u.id === userId);
  const newMessage: Message = {
    id: MOCK_MESSAGES.length + 1,
    conversation_id: conversationId,
    sender_id: userId,
    content,
    created_at: new Date().toISOString(),
    sender_username: sender ? `${sender.username}#${sender.id}` : 'Inconnu'
  };
  
  // 1. Insert into DB
  MOCK_MESSAGES.push(newMessage);
  
  // 2. Emit Socket Event (This happens on server after DB insert)
  mockSocket.emitNewMessage(conversationId, newMessage);
  
  return newMessage;
};

// Helper to get other users for private chat name resolution
export const getOtherParticipant = (conversationId: number, currentUserId: number): User | undefined => {
    const otherParticpant = MOCK_PARTICIPANTS.find(p => p.conversation_id === conversationId && p.user_id !== currentUserId);
    if (!otherParticpant) return undefined;
    return MOCK_USERS.find(u => u.id === otherParticpant.user_id);
};