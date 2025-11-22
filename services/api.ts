import { io, Socket } from 'socket.io-client';
import { User, Conversation, Message, AuthResponse, FriendRequest } from '../types';

// --- CONFIGURATION ---
// Detect if we are running locally to switch between Localhost and Render
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// If local, use port 3001 (standard node server), else use production URL
const API_BASE = isLocal ? 'http://localhost:3001' : 'https://talkioo.onrender.com';
const API_URL = `${API_BASE}/api`;

console.log(`[Talkio] Environment: ${isLocal ? 'Local' : 'Production'}`);
console.log(`[Talkio] Connecting to Backend: ${API_BASE}`);

// --- SOCKET INSTANCE ---
let socket: Socket;

export const connectSocket = (token: string) => {
    if (socket && socket.connected) return;
    
    socket = io(API_BASE, {
        auth: { token },
        transports: ['websocket', 'polling'], 
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
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
        
        // Check content type to avoid crashing on HTML 404s
        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await response.json();
        } else {
            // If not JSON (likely HTML error page), throw generic error or text
            const text = await response.text();
            throw new Error(`Erreur serveur (${response.status}): Endpoint introuvable ou erreur interne.`);
        }
        
        if (!response.ok) {
            throw new Error(data.error || 'Erreur API');
        }
        
        return data;
    } catch (error: any) {
        if (error.message === 'Failed to fetch') {
            throw new Error("Impossible de joindre le serveur. Il démarre peut-être ? (Attendez 30s)");
        }
        console.error(`API Error (${endpoint}):`, error.message);
        throw error;
    }
};

// --- AUTH ---
export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
    return await fetchWithAuth('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
    return await fetchWithAuth('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
};

export const getUserByIdAPI = async (id: string): Promise<User | undefined> => {
    try { return await fetchWithAuth(`/users/${id}`); } catch (e) { return undefined; }
};

export const getOnlineUsersAPI = async (): Promise<string[]> => {
    try { return await fetchWithAuth('/users/online'); } catch (e) { return []; }
};

// --- CONVERSATIONS ---
export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => {
    return await fetchWithAuth('/conversations');
};

export const createGroupConversationAPI = async (name: string, participantIds: string[]): Promise<{conversationId: string}> => {
    return await fetchWithAuth('/conversations', {
        method: 'POST',
        body: JSON.stringify({ name, participantIds })
    });
};

export const deleteConversationAPI = async (conversationId: string, userId: string): Promise<boolean> => {
    try { await fetchWithAuth(`/conversations/${conversationId}`, { method: 'DELETE' }); return true; } catch (e) { return false; }
};

export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => {
    return await fetchWithAuth(`/conversations/${conversationId}/other`);
};

export const getContactsAPI = async (): Promise<User[]> => {
    return await fetchWithAuth('/contacts');
};

// --- MESSAGES ---
export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => {
    return await fetchWithAuth(`/conversations/${conversationId}/messages`);
};

export const sendMessageAPI = async (conversationId: string, userId: string, content: string, repliedToId?: string): Promise<Message> => {
    return await fetchWithAuth('/messages', { 
        method: 'POST', 
        body: JSON.stringify({ 
            conversation_id: conversationId, 
            content,
            replied_to_message_id: repliedToId 
        }) 
    });
};

export const editMessageAPI = async (messageId: string, newContent: string): Promise<Message> => {
    return await fetchWithAuth(`/messages/${messageId}`, { method: 'PUT', body: JSON.stringify({ content: newContent }) });
};

export const deleteMessageAPI = async (messageId: string): Promise<boolean> => {
    try { await fetchWithAuth(`/messages/${messageId}`, { method: 'DELETE' }); return true; } catch (e) { return false; }
};

export const markMessagesAsReadAPI = async (conversationId: string): Promise<void> => {
    try { await fetchWithAuth(`/conversations/${conversationId}/read`, { method: 'POST' }); } catch(e) { console.error(e); }
};

// --- FRIEND REQUESTS ---
export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<any> => {
    return await fetchWithAuth('/friend_requests', { method: 'POST', body: JSON.stringify({ targetIdentifier }) });
};

export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => {
    return await fetchWithAuth('/friend_requests');
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    const res = await fetchWithAuth(`/friend_requests/${requestId}/respond`, { method: 'POST', body: JSON.stringify({ status }) });
    if (status === 'accepted' && res.conversationId) return { id: res.conversationId } as Conversation;
    return null;
};

// --- TYPING EVENTS ---
export const sendTypingEvent = (conversationId: string) => {
    if(socket) socket.emit('typing_start', { conversationId });
};

export const sendStopTypingEvent = (conversationId: string) => {
    if(socket) socket.emit('typing_stop', { conversationId });
};

// --- REALTIME SUBSCRIPTIONS ---

export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    if (!socket) return () => {};
    
    socket.emit('join_room', conversationId);

    const handler = (msg: Message) => {
        if (msg.conversation_id === conversationId) onMessage(msg);
    };

    socket.on('new_message', handler);
    socket.on('message_update', handler);

    return () => {
        socket.off('new_message', handler);
        socket.off('message_update', handler);
    };
};

export const subscribeToReadReceipts = (conversationId: string, onReadUpdate: () => void) => {
    if (!socket) return () => {};
    
    const handler = (data: { conversationId: string }) => {
        if (data.conversationId === conversationId) {
            onReadUpdate();
        }
    };
    
    socket.on('READ_RECEIPT_UPDATE', handler);
    return () => socket.off('READ_RECEIPT_UPDATE', handler);
};

export const subscribeToTypingEvents = (conversationId: string, onTyping: (userId: string, isTyping: boolean) => void) => {
    if (!socket) return () => {};
    
    const handler = (data: { conversationId: string, userId: string, isTyping: boolean }) => {
        if (data.conversationId === conversationId) {
            onTyping(data.userId, data.isTyping);
        }
    };
    socket.on('typing_update', handler);
    return () => socket.off('typing_update', handler);
};

export const subscribeToUserStatus = (onStatusChange: (userId: string, isOnline: boolean) => void) => {
    if (!socket) return () => {};
    const handler = (data: { userId: string, isOnline: boolean }) => {
        onStatusChange(data.userId, data.isOnline);
    };
    socket.on('user_status', handler);
    return () => socket.off('user_status', handler);
};

export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    if (!socket) return () => {};
    const handler = () => onNewRequest();
    socket.on('friend_request', handler);
    return () => socket.off('friend_request', handler);
};

export const subscribeToConversationsList = (onUpdate: () => void) => {
    if (!socket) return () => {};

    const handler = (data: any) => {
        console.log("List Update Event:", data);
        onUpdate();
    };
    
    // Listen to Global User Events
    socket.on('conversation_added', handler);
    socket.on('conversation_updated', handler);
    socket.on('request_accepted', handler); 
    
    return () => {
        socket.off('conversation_added', handler);
        socket.off('conversation_updated', handler);
        socket.off('request_accepted', handler);
    };
};