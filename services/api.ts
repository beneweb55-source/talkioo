import { io, Socket } from 'socket.io-client';
import { User, Conversation, Message, AuthResponse, FriendRequest } from '../types';

// --- CONFIGURATION DYNAMIQUE ---

// 🚨 URL DE PRODUCTION (Render)
const PROD_BACKEND_URL = 'https://talkioo.onrender.com';

// DÉTECTION AUTOMATIQUE DE L'ENVIRONNEMENT
// Si on est sur localhost, on utilise le backend local. Sinon, la prod.
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const API_BASE = isLocal ? 'http://localhost:3001' : PROD_BACKEND_URL;
const API_URL = `${API_BASE}/api`;

if (isLocal) {
    console.log(`[Talkio] 🔧 Mode Dev détecté: Connexion au backend LOCAL (${API_BASE})`);
} else {
    console.log(`[Talkio] 🚀 Mode Prod détecté: Connexion au backend DISTANT (${API_BASE})`);
}

// --- SOCKET INSTANCE ---
let socket: Socket;

export const connectSocket = (token: string) => {
    if (socket && socket.connected) return;
    
    console.log(`[Socket] Connecting to ${API_BASE}...`);
    socket = io(API_BASE, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
        console.log('✅ Socket connected:', socket.id);
        socket.emit('authenticate', token);
    });

    socket.on('connect_error', (err) => {
        console.error("❌ Socket Connection Error:", err.message);
    });
};

export const disconnectSocket = () => {
    if (socket) socket.disconnect();
};

// --- API HELPER ---
const fetchWithAuth = async (endpoint: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('talkio_auth_token');
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
        });
        
        const contentType = response.headers.get("content-type");
        
        // Si la réponse n'est pas du JSON (ex: erreur 404 HTML, erreur serveur 500)
        if (contentType && contentType.indexOf("application/json") === -1) {
            const text = await response.text();
            console.error(`[API Error] Non-JSON response from ${endpoint}:`, text.substring(0, 200)); // Log le début du HTML
            throw new Error(`Erreur serveur (${response.status}): Réponse inattendue.`);
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || `Erreur API ${response.status}`);
        }
        
        return data;
    } catch (error: any) {
        if (error.message === 'Failed to fetch') {
            throw new Error("Impossible de joindre le serveur. Vérifiez qu'il est lancé (npm start dans /server) !");
        }
        console.error(`API Error (${endpoint}):`, error.message);
        throw error;
    }
};

// --- AUTH ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
    return await fetchWithAuth('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password })
    });
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
    return await fetchWithAuth('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
};

export const getUserByIdAPI = async (id: string): Promise<User | undefined> => {
    try {
        return await fetchWithAuth(`/users/${id}`);
    } catch (e) {
        return undefined;
    }
};

// --- CONVERSATIONS ---

export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => {
    return await fetchWithAuth('/conversations');
};

export const deleteConversationAPI = async (conversationId: string, userId: string): Promise<boolean> => {
    try {
        await fetchWithAuth(`/conversations/${conversationId}`, { method: 'DELETE' });
        return true;
    } catch (e) {
        return false;
    }
};

export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => {
    return await fetchWithAuth(`/conversations/${conversationId}/other`);
};

// --- MESSAGES ---

export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => {
    return await fetchWithAuth(`/conversations/${conversationId}/messages`);
};

export const sendMessageAPI = async (conversationId: string, userId: string, content: string): Promise<Message> => {
    return await fetchWithAuth('/messages', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: conversationId, content })
    });
};

export const editMessageAPI = async (messageId: string, newContent: string): Promise<Message> => {
    return await fetchWithAuth(`/messages/${messageId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: newContent })
    });
};

export const deleteMessageAPI = async (messageId: string): Promise<boolean> => {
    try {
        await fetchWithAuth(`/messages/${messageId}`, { method: 'DELETE' });
        return true;
    } catch (e) {
        return false;
    }
};

// --- FRIEND REQUESTS ---

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<any> => {
    const response = await fetchWithAuth('/friend_requests', {
        method: 'POST',
        body: JSON.stringify({ targetIdentifier })
    });
    return response;
};

export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => {
    return await fetchWithAuth('/friend_requests');
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    const res = await fetchWithAuth(`/friend_requests/${requestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ status })
    });
    
    if (status === 'accepted' && res.conversationId) {
        return { id: res.conversationId } as Conversation;
    }
    return null;
};

// --- REALTIME SUBSCRIPTIONS ---

export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    if (!socket) return () => {};
    
    socket.emit('join_room', conversationId);

    const handler = (msg: Message) => {
        if (msg.conversation_id === conversationId) {
            onMessage(msg);
        }
    };

    socket.on('new_message', handler);
    socket.on('message_update', handler);

    return () => {
        socket.off('new_message', handler);
        socket.off('message_update', handler);
    };
};

export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    if (!socket) return () => {};
    
    const handler = () => onNewRequest();
    socket.on('friend_request', handler);
    
    return () => socket.off('friend_request', handler);
};

export const subscribeToConversationsList = (onUpdate: () => void) => {
    if (!socket) return () => {};

    const handler = () => onUpdate();
    socket.on('new_message', handler);
    socket.on('message_update', handler);
    socket.on('request_accepted', handler);
    
    return () => {
        socket.off('new_message', handler);
        socket.off('message_update', handler);
        socket.off('request_accepted', handler);
    };
};

export const sendTypingEvent = (conversationId: string, isTyping: boolean, username: string) => {
    if (!socket) return;
    if (isTyping) {
        socket.emit('typing_start', { conversationId, username });
    } else {
        socket.emit('typing_stop', { conversationId, username });
    }
};

export const subscribeToTypingEvents = (
    conversationId: string, 
    onStart: (username: string) => void, 
    onStop: (username: string) => void
) => {
    if (!socket) return () => {};

    const handleStart = (data: { conversationId: string, username: string }) => {
        if (data.conversationId === conversationId) {
            // console.log('[Typing Start]', data.username);
            onStart(data.username);
        }
    };

    const handleStop = (data: { conversationId: string, username: string }) => {
        if (data.conversationId === conversationId) {
            // console.log('[Typing Stop]', data.username);
            onStop(data.username);
        }
    };

    socket.on('typing_start', handleStart);
    socket.on('typing_stop', handleStop);

    return () => {
        socket.off('typing_start', handleStart);
        socket.off('typing_stop', handleStop);
    };
};