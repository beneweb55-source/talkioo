import { io, Socket } from 'socket.io-client';
import { User, Conversation, Message, AuthResponse, FriendRequest } from '../types';

// --- CONFIGURATION DYNAMIQUE ---

// 🚨 URL DE PRODUCTION (Render)
// Pour ce MVP, on force la connexion au backend en ligne même en local
// cela permet de tester l'app sans avoir à lancer le serveur Node localement.
const PROD_BACKEND_URL = 'https://talkioo.onrender.com';

// Si vous voulez utiliser un serveur local, décommentez la ligne suivante :
// const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : PROD_BACKEND_URL;

const API_BASE = PROD_BACKEND_URL; 
const API_URL = `${API_BASE}/api`;

console.log(`[Talkio] Connecting to Backend: ${API_BASE}`);

// --- SOCKET INSTANCE ---
let socket: Socket;

export const connectSocket = (token: string) => {
    if (socket && socket.connected) return;
    
    socket = io(API_BASE, {
        auth: { token },
        transports: ['websocket', 'polling'], // Polling en backup pour Vercel/Firewalls
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        // Join personal user channel for notifications
        socket.emit('authenticate', token);
    });

    socket.on('connect_error', (err) => {
        console.error("Socket Connection Error:", err);
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
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Erreur API');
        }
        
        return data;
    } catch (error: any) {
        // Transforme "Failed to fetch" en un message plus clair pour l'utilisateur
        if (error.message === 'Failed to fetch') {
            throw new Error("Impossible de joindre le serveur. Il démarre peut-être ? (Attendez 30s)");
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