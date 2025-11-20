import { io } from 'socket.io-client';
import { User, Conversation, Message, AuthResponse, FriendRequest } from '../types';

// POINTING TO YOUR LOCAL NODE SERVER
const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

// Socket Instance
const socket = io(SOCKET_URL, {
    autoConnect: false
});

// Helper for fetch with Auth header
const fetchWithAuth = async (endpoint: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('talkio_auth_token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erreur API');
        }
        
        return await response.json();
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        throw error;
    }
};

// --- AUTH ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
    const data = await fetchWithAuth('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password })
    });
    
    // Auto connect socket on auth
    if(data.user) {
        socket.auth = { token: data.token };
        socket.connect();
        socket.emit('join_user_channel', data.user.id);
    }
    return data;
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
    const data = await fetchWithAuth('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
    
    if(data.user) {
        socket.auth = { token: data.token };
        socket.connect();
        socket.emit('join_user_channel', data.user.id);
    }
    return data;
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

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<boolean> => {
    await fetchWithAuth('/friend_requests', {
        method: 'POST',
        body: JSON.stringify({ targetIdentifier })
    });
    return true;
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
        return { id: res.conversationId } as Conversation; // Partial mock return, will refresh anyway
    }
    return null;
};

// --- SOCKET SUBSCRIPTIONS ---

export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    // Join the room
    socket.emit('join_room', conversationId);

    const handleNew = (msg: Message) => {
        if (msg.conversation_id === conversationId) onMessage(msg);
    };

    const handleUpdate = (msg: Message) => {
        if (msg.conversation_id === conversationId) onMessage(msg);
    };

    socket.on('new_message', handleNew);
    socket.on('message_update', handleUpdate);

    return () => {
        socket.off('new_message', handleNew);
        socket.off('message_update', handleUpdate);
    };
};

export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    // Make sure we are in user channel
    socket.emit('join_user_channel', userId);
    
    const handler = () => onNewRequest();
    socket.on('friend_request', handler);
    
    return () => socket.off('friend_request', handler);
};

export const subscribeToConversationsList = (onUpdate: () => void) => {
    // For MVP, we reuse message events to trigger list updates
    const handler = () => onUpdate();
    socket.on('new_message', handler);
    socket.on('message_update', handler);
    return () => {
        socket.off('new_message', handler);
        socket.off('message_update', handler);
    };
};
