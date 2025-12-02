import { io, Socket } from 'socket.io-client';
import { User, Conversation, Message, AuthResponse, FriendRequest, Reaction, GroupMember, Sticker } from '../types';

// --- CONFIGURATION ---
const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.')
);

// In local dev, target port 3001. In prod, use relative API path.
const API_BASE = isLocal ? `http://${window.location.hostname}:3001` : 'https://talkioo.onrender.com';
const API_URL = `${API_BASE}/api`;

console.log(`[Talkio] API Target: ${API_URL}`);

// --- SOCKET INSTANCE ---
let socket: Socket;

export const connectSocket = (token: string, userId: string) => {
    if (socket && socket.connected) return;
    
    // Connect to the same host as API
    socket = io(API_BASE, {
        auth: { token },
        query: { userId }, 
        transports: ['polling', 'websocket'], 
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 60000
    });

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
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
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    try {
        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.indexOf("application/json") !== -1) data = await response.json();
        else { const text = await response.text(); throw new Error(`Erreur serveur (${response.status}): ${text || response.statusText}`); }
        if (!response.ok) throw new Error(data.error || 'Erreur API');
        return data;
    } catch (error: any) {
        if (error.message === 'Failed to fetch') throw new Error("Impossible de joindre le serveur.");
        console.error(`API Error (${endpoint}):`, error.message);
        throw error;
    }
};

// --- AUTH ---
export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => fetchWithAuth('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => fetchWithAuth('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const getUserByIdAPI = async (id: string): Promise<User | undefined> => { try { return await fetchWithAuth(`/users/${id}`); } catch (e) { return undefined; } };
export const getOnlineUsersAPI = async (): Promise<string[]> => { try { return await fetchWithAuth('/users/online'); } catch (e) { return []; } };
export const updateProfileAPI = async (data: any): Promise<User> => {
    if (data.avatar) { const formData = new FormData(); if(data.username) formData.append('username', data.username); if(data.email) formData.append('email', data.email); if(data.theme_color) formData.append('theme_color', data.theme_color); formData.append('avatar', data.avatar); return await fetchWithAuth('/users/profile', { method: 'PUT', body: formData }); }
    return await fetchWithAuth('/users/profile', { method: 'PUT', body: JSON.stringify(data) });
};
export const updatePasswordAPI = async (data: any): Promise<void> => fetchWithAuth('/users/password', { method: 'PUT', body: JSON.stringify(data) });
export const blockUserAPI = async (userId: string) => fetchWithAuth('/users/block', { method: 'POST', body: JSON.stringify({ userId }) });
export const unblockUserAPI = async (userId: string) => fetchWithAuth('/users/unblock', { method: 'POST', body: JSON.stringify({ userId }) });
export const getBlockedUsersAPI = async (): Promise<User[]> => fetchWithAuth('/users/blocked');
export const removeFriendAPI = async (friendId: string) => fetchWithAuth(`/friends/${friendId}`, { method: 'DELETE' });
export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => fetchWithAuth('/conversations');
export const createGroupConversationAPI = async (name: string, participantIds: string[]) => fetchWithAuth('/conversations', { method: 'POST', body: JSON.stringify({ name, participantIds }) });
export const updateGroup = async (id: string, data: any) => { if(data.avatar) { const fd = new FormData(); if(data.name) fd.append('name', data.name); fd.append('avatar', data.avatar); return await fetchWithAuth(`/conversations/${id}`, { method: 'PUT', body: fd }); } return await fetchWithAuth(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify(data) }); };
export const getGroupMembers = async (id: string): Promise<GroupMember[]> => fetchWithAuth(`/conversations/${id}/members`);
export const addMembers = async (id: string, userIds: string[]) => fetchWithAuth(`/conversations/${id}/members`, { method: 'POST', body: JSON.stringify({ userIds }) });
export const removeMember = async (id: string, userId: string) => fetchWithAuth(`/conversations/${id}/members/${userId}`, { method: 'DELETE' });
export const leaveGroup = async (id: string) => fetchWithAuth(`/conversations/${id}/leave`, { method: 'DELETE' });
export const destroyGroup = async (id: string) => fetchWithAuth(`/conversations/${id}/destroy`, { method: 'DELETE' });
export const deleteConversationAPI = async (conversationId: string, userId: string) => { try { await fetchWithAuth(`/conversations/${conversationId}`, { method: 'DELETE' }); return true; } catch(e) { return false; } };
export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => fetchWithAuth(`/conversations/${conversationId}/other`);
export const getContactsAPI = async (): Promise<User[]> => fetchWithAuth('/contacts');
export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => fetchWithAuth(`/conversations/${conversationId}/messages`);
export const sendMessageAPI = async (conversationId: string, userId: string, content: string, repliedToId?: string, messageType = 'text', file?: File, attachmentUrl?: string): Promise<Message> => {
    if (file) { const fd = new FormData(); fd.append('conversation_id', conversationId); fd.append('content', content || ""); if(repliedToId) fd.append('replied_to_message_id', repliedToId); fd.append('media', file); fd.append('message_type', messageType); return await fetchWithAuth('/messages', { method: 'POST', body: fd }); }
    return await fetchWithAuth('/messages', { method: 'POST', body: JSON.stringify({ conversation_id: conversationId, content: content || "", replied_to_message_id: repliedToId, message_type: messageType, attachment_url: attachmentUrl }) });
};
export const getTrendingGifsAPI = async (pos?: string) => fetchWithAuth(pos ? `/gifs/trending?pos=${pos}` : '/gifs/trending');
export const searchGifsAPI = async (query: string, pos?: string) => fetchWithAuth(`/gifs/search?q=${encodeURIComponent(query)}${pos ? `&pos=${pos}` : ''}`);
export const getStickersAPI = async (): Promise<Sticker[]> => fetchWithAuth('/stickers');
export const uploadStickerAPI = async (file: File): Promise<Sticker> => { const fd = new FormData(); fd.append('sticker', file); return await fetchWithAuth('/stickers', { method: 'POST', body: fd }); };
export const reactToMessageAPI = async (messageId: string, emoji: string) => fetchWithAuth(`/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
export const editMessageAPI = async (messageId: string, newContent: string) => fetchWithAuth(`/messages/${messageId}`, { method: 'PUT', body: JSON.stringify({ content: newContent }) });
export const deleteMessageAPI = async (messageId: string) => { try { await fetchWithAuth(`/messages/${messageId}`, { method: 'DELETE' }); return true; } catch(e) { return false; } };
export const markMessagesAsReadAPI = async (conversationId: string) => { try { await fetchWithAuth(`/conversations/${conversationId}/read`, { method: 'POST' }); } catch(e) {} };
export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string) => fetchWithAuth('/friend_requests', { method: 'POST', body: JSON.stringify({ targetIdentifier }) });
export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => fetchWithAuth('/friend_requests');
export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted'|'rejected') => { const res = await fetchWithAuth(`/friend_requests/${requestId}/respond`, { method: 'POST', body: JSON.stringify({ status }) }); if (status === 'accepted') return { id: res.conversationId }; return null; };

// --- PUSH NOTIFICATIONS ---
export const getVapidPublicKeyAPI = async () => fetchWithAuth('/push/vapid-public-key');
export const subscribeToPushAPI = async (subscription: any) => fetchWithAuth('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });

// --- NEW: AGORA TOKEN API ---
export const getAgoraTokenAPI = async (channelName: string): Promise<{ token: string, appId: string }> => {
    return await fetchWithAuth(`/agora/token/${channelName}`);
};

// --- SOCKET EVENTS ---
export const sendTypingEvent = (conversationId: string) => { if(socket) socket.emit('typing_start', { conversationId }); };
export const sendStopTypingEvent = (conversationId: string) => { if(socket) socket.emit('typing_stop', { conversationId }); };
export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => { if (!socket) return () => {}; socket.emit('join_room', conversationId); const handler = (msg: Message) => { if (msg.conversation_id === conversationId) onMessage(msg); }; socket.on('new_message', handler); socket.on('message_update', handler); return () => { socket.off('new_message', handler); socket.off('message_update', handler); }; };
export const subscribeToReactionUpdates = (conversationId: string, onUpdate: (messageId: string, reactions: Reaction[]) => void) => { if (!socket) return () => {}; const handler = (data: { messageId: string, reactions: Reaction[] }) => { onUpdate(data.messageId, data.reactions); }; socket.on('message_reaction_update', handler); return () => socket.off('message_reaction_update', handler); };
export const subscribeToReadReceipts = (conversationId: string, onReadUpdate: () => void) => { if (!socket) return () => {}; const handler = (data: { conversationId: string }) => { if (data.conversationId === conversationId) onReadUpdate(); }; socket.on('READ_RECEIPT_UPDATE', handler); return () => socket.off('READ_RECEIPT_UPDATE', handler); };
export const subscribeToTypingEvents = (conversationId: string, onTyping: (userId: string, isTyping: boolean) => void) => { if (!socket) return () => {}; const handler = (data: { conversationId: string, userId: string, isTyping: boolean }) => { if (data.conversationId === conversationId) onTyping(data.userId, data.isTyping); }; socket.on('typing_update', handler); return () => socket.off('typing_update', handler); };
export const subscribeToUserStatus = (onStatusChange: (userId: string, isOnline: boolean) => void) => { if (!socket) return () => {}; const handler = (data: { userId: string, isOnline: boolean }) => { onStatusChange(data.userId, data.isOnline); }; socket.on('USER_STATUS_UPDATE', handler); return () => socket.off('USER_STATUS_UPDATE', handler); };
export const subscribeToUserProfileUpdates = (onUpdate: (user: User) => void) => { if (!socket) return () => {}; const handler = (data: User) => onUpdate(data); socket.on('USER_PROFILE_UPDATE', handler); return () => socket.off('USER_PROFILE_UPDATE', handler); };
export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => { if (!socket) return () => {}; const handler = () => onNewRequest(); socket.on('friend_request', handler); return () => socket.off('friend_request', handler); };
export const subscribeToConversationsList = (onUpdate: () => void) => { if (!socket) return () => {}; const handler = () => onUpdate(); socket.on('conversation_added', handler); socket.on('conversation_updated', handler); socket.on('conversation_removed', handler); socket.on('request_accepted', handler); return () => { socket.off('conversation_added', handler); socket.off('conversation_updated', handler); socket.off('conversation_removed', handler); socket.off('request_accepted', handler); }; };

// --- CALL EVENTS ---
export const sendCallSignal = (type: 'start' | 'accept' | 'reject' | 'end', payload: any) => {
    if (!socket) return;
    socket.emit(`call_${type}`, payload);
};

export const subscribeToCallEvents = (
    onIncoming: (data: any) => void,
    onAccepted: (data: any) => void,
    onDeclined: (data: any) => void
) => {
    if (!socket) return () => {};
    socket.on('incoming_call', onIncoming);
    socket.on('user_joined_call', onAccepted);
    socket.on('call_declined', onDeclined);
    return () => {
        socket.off('incoming_call', onIncoming);
        socket.off('user_joined_call', onAccepted);
        socket.off('call_declined', onDeclined);
    };
};