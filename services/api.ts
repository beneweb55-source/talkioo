import { io, Socket } from 'socket.io-client';
import { User, Conversation, Message, AuthResponse, FriendRequest, Reaction } from '../types';

// --- CONFIGURATION ---
const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// En local, on utilise une chaine vide '' pour utiliser le proxy Vite
const API_BASE = isLocal ? '' : 'https://talkioo.onrender.com';
const API_URL = `${API_BASE}/api`;

console.log(`[Talkio] API Target: ${API_URL}`);

// --- SOCKET INSTANCE ---
let socket: Socket;

export const connectSocket = (token: string, userId: string) => {
    if (socket && socket.connected) return;
    
    // Le socket local doit viser le port 3001 directement
    const SOCKET_URL = isLocal ? 'http://localhost:3001' : 'https://talkioo.onrender.com';

    socket = io(SOCKET_URL, {
        auth: { token },
        query: { userId }, 
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
    
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
        });
        
        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.indexOf("application/json") !== -1) {
            data = await response.json();
        } else {
            const text = await response.text();
            throw new Error(`Erreur serveur (${response.status}): ${text || response.statusText}`);
        }
        
        if (!response.ok) {
            throw new Error(data.error || 'Erreur API');
        }
        
        return data;
    } catch (error: any) {
        if (error.message === 'Failed to fetch') {
            throw new Error("Impossible de joindre le serveur. Vérifiez que le backend (port 3001) tourne.");
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

export const sendMessageAPI = async (conversationId: string, userId: string, content: string, repliedToId?: string, messageType: 'text'|'image' = 'text', file?: File): Promise<Message> => {
    
    if (file) {
        // Validation Size (Double check client-side)
        if (file.size > 10 * 1024 * 1024) throw new Error("Image trop volumineuse (Max 10Mo)");
        
        const formData = new FormData();
        
        formData.append('conversation_id', conversationId);
        
        // CORRECTION : Force explicit empty string if content is missing.
        // This prevents 'null' string conversion issues on the backend.
        const safeContent = (content && content !== 'undefined' && content !== 'null') ? String(content) : "";
        formData.append('content', safeContent);
        
        if (repliedToId) formData.append('replied_to_message_id', repliedToId);
        
        // Append file last
        formData.append('media', file);
        
        return await fetchWithAuth('/messages', { 
            method: 'POST', 
            body: formData 
        });
    } else {
        return await fetchWithAuth('/messages', { 
            method: 'POST', 
            body: JSON.stringify({ 
                conversation_id: conversationId, 
                content: content || "", 
                replied_to_message_id: repliedToId,
                message_type: 'text'
            }) 
        });
    }
};

// --- REACTIONS ---
export const reactToMessageAPI = async (messageId: string, emoji: string): Promise<any> => {
    return await fetchWithAuth(`/messages/${messageId}/react`, {
        method: 'POST',
        body: JSON.stringify({ emoji })
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

// --- PUSH NOTIFICATIONS ---
export const getVapidPublicKeyAPI = async (): Promise<{ publicKey: string }> => {
    return await fetchWithAuth('/push/vapid-public-key');
};

export const subscribeToPushAPI = async (subscription: PushSubscription): Promise<any> => {
    return await fetchWithAuth('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription)
    });
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

export const subscribeToReactionUpdates = (conversationId: string, onUpdate: (messageId: string, reactions: Reaction[]) => void) => {
    if (!socket) return () => {};
    const handler = (data: { messageId: string, reactions: Reaction[] }) => {
        onUpdate(data.messageId, data.reactions);
    };
    socket.on('message_reaction_update', handler);
    return () => socket.off('message_reaction_update', handler);
};

export const subscribeToReadReceipts = (conversationId: string, onReadUpdate: () => void) => {
    if (!socket) return () => {};
    const handler = (data: { conversationId: string }) => {
        if (data.conversationId === conversationId) onReadUpdate();
    };
    socket.on('READ_RECEIPT_UPDATE', handler);
    return () => socket.off('READ_RECEIPT_UPDATE', handler);
};

export const subscribeToTypingEvents = (conversationId: string, onTyping: (userId: string, isTyping: boolean) => void) => {
    if (!socket) return () => {};
    const handler = (data: { conversationId: string, userId: string, isTyping: boolean }) => {
        if (data.conversationId === conversationId) onTyping(data.userId, data.isTyping);
    };
    socket.on('typing_update', handler);
    return () => socket.off('typing_update', handler);
};

export const subscribeToUserStatus = (onStatusChange: (userId: string, isOnline: boolean) => void) => {
    if (!socket) return () => {};
    const handler = (data: { userId: string, isOnline: boolean }) => {
        onStatusChange(data.userId, data.isOnline);
    };
    socket.on('USER_STATUS_UPDATE', handler);
    return () => socket.off('USER_STATUS_UPDATE', handler);
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
    socket.on('conversation_added', handler);
    socket.on('conversation_updated', handler);
    socket.on('request_accepted', handler);
    return () => {
        socket.off('conversation_added', handler);
        socket.off('conversation_updated', handler);
        socket.off('request_accepted', handler);
    };
};