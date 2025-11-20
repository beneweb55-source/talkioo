import { supabase } from './supabaseClient';
import { User, Conversation, Message, AuthResponse, FriendRequest } from '../types';

// --- AUTH ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
    if (!supabase) throw new Error("Supabase non configuré");

    // 1. Créer l'auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error("Erreur lors de la création du compte");

    // 2. Créer le profil public
    // On génère un TAG aléatoire de 4 chiffres
    const tag = Math.floor(1000 + Math.random() * 9000).toString();
    
    // On insère dans la table profiles. Si un trigger SQL existe déjà, cela peut renvoyer une erreur de duplication qu'on ignore.
    const { error: profileError } = await supabase
        .from('profiles')
        .insert([{ id: authData.user.id, username, tag, email }]);

    if (profileError) {
        console.warn("Profile insert warning (might be handled by trigger):", profileError);
    }

    const user: User = {
        id: authData.user.id,
        username,
        tag,
        email,
        created_at: new Date().toISOString()
    };

    return { user, token: authData.session?.access_token || '' };
};

export const loginAPI = async (email: string, password: string): Promise<AuthResponse> => {
    if (!supabase) throw new Error("Supabase non configuré");

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) throw error;
    if (!data.user) throw new Error("Pas d'utilisateur");

    // Récupérer le profil
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

    if (profileError || !profile) throw new Error("Profil utilisateur introuvable");

    return { 
        user: profile as User, 
        token: data.session?.access_token || '' 
    };
};

export const getUserByIdAPI = async (id: string): Promise<User | undefined> => {
    if (!supabase) return undefined;
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    return data as User;
};

// --- CONVERSATIONS ---

export const getConversationsAPI = async (userId: string): Promise<Conversation[]> => {
    if (!supabase) return [];

    // 1. Trouver toutes les conversations où l'utilisateur est
    const { data: participations } = await supabase
        .from('participants')
        .select('conversation_id')
        .eq('user_id', userId);

    if (!participations || participations.length === 0) return [];

    const convIds = participations.map(p => p.conversation_id);

    // 2. Charger les infos des conversations
    const { data: conversations } = await supabase
        .from('conversations')
        .select('*')
        .in('id', convIds)
        .order('created_at', { ascending: false });
        
    if (!conversations) return [];

    // 3. Récupérer le dernier message pour chaque conversation (pour l'UI de la liste)
    // Note: En prod, on ferait une View SQL ou une fonction RPC pour éviter le N+1, mais ok pour MVP.
    const conversationsWithMsg = await Promise.all(conversations.map(async (c) => {
        const { data: msgs } = await supabase
            .from('messages')
            .select('content, created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1);
            
        return {
            ...c,
            last_message: msgs?.[0]?.content || "Nouvelle discussion",
            last_message_at: msgs?.[0]?.created_at || c.created_at
        };
    }));

    return conversationsWithMsg.sort((a, b) => 
        new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime()
    );
};

// --- MESSAGES ---

export const getMessagesAPI = async (conversationId: string): Promise<Message[]> => {
    if (!supabase) return [];

    const { data: messages } = await supabase
        .from('messages')
        .select(`
            *,
            profiles:sender_id (username, tag)
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (!messages) return [];

    return messages.map((m: any) => ({
        ...m,
        sender_username: m.profiles ? `${m.profiles.username}#${m.profiles.tag}` : 'Inconnu'
    }));
};

export const sendMessageAPI = async (conversationId: string, userId: string, content: string): Promise<Message> => {
    if (!supabase) throw new Error("No Connection");

    const { data, error } = await supabase
        .from('messages')
        .insert([{ conversation_id: conversationId, sender_id: userId, content }])
        .select()
        .single();

    if (error) throw error;
    
    // On récupère l'info du sender pour l'affichage immédiat
    const sender = await getUserByIdAPI(userId);

    return {
        ...data,
        sender_username: sender ? `${sender.username}#${sender.tag}` : 'Moi'
    };
};

// --- FRIEND REQUESTS ---

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<boolean> => {
    if (!supabase) return false;

    // Parsing de "Nom#1234"
    const parts = targetIdentifier.split('#');
    if (parts.length !== 2) throw new Error("Format attendu : Nom#1234");
    
    const usernameTarget = parts[0].trim();
    const tagTarget = parts[1].trim();

    if (!usernameTarget || !tagTarget) throw new Error("Format invalide.");

    // Recherche du profil cible (Insensible à la casse pour le username grâce à ilike)
    const { data: targetUser, error: userError } = await supabase
        .from('profiles')
        .select('id, username, tag')
        .ilike('username', usernameTarget) // ilike = insensitive like
        .eq('tag', tagTarget)
        .single();

    if (userError || !targetUser) throw new Error(`Utilisateur "${usernameTarget}#${tagTarget}" introuvable.`);
    if (targetUser.id === currentUserId) throw new Error("Vous ne pouvez pas vous ajouter vous-même.");

    // Vérifier s'il y a déjà une relation ou une demande
    const { data: existing } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${targetUser.id}),and(sender_id.eq.${targetUser.id},receiver_id.eq.${currentUserId})`);

    if (existing && existing.length > 0) {
         const pending = existing.find(r => r.status === 'pending');
         const accepted = existing.find(r => r.status === 'accepted');
         
         if (accepted) throw new Error("Vous êtes déjà amis avec cette personne.");
         if (pending) throw new Error("Une demande d'ami est déjà en attente.");
    }

    // Vérifier s'ils ont déjà une conversation privée ensemble (optionnel, mais propre)
    // (On saute cette étape pour le MVP pour faire confiance à la table friend_requests)

    // Insertion de la demande
    const { error } = await supabase
        .from('friend_requests')
        .insert([{ sender_id: currentUserId, receiver_id: targetUser.id, status: 'pending' }]);

    if (error) throw error;
    return true;
};

export const getIncomingFriendRequestsAPI = async (userId: string): Promise<FriendRequest[]> => {
    if (!supabase) return [];
    
    const { data, error } = await supabase
        .from('friend_requests')
        .select(`
            *,
            sender:sender_id (username, tag, email)
        `)
        .eq('receiver_id', userId)
        .eq('status', 'pending');

    if (error) return [];
    
    return data.map((r: any) => ({
        ...r,
        sender: { ...r.sender, id: r.sender_id } // Aplatir la structure pour le type User
    }));
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    if (!supabase) return null;

    // 1. Mettre à jour le statut
    const { data: request, error: updateError } = await supabase
        .from('friend_requests')
        .update({ status })
        .eq('id', requestId)
        .select()
        .single();

    if (updateError || !request) throw new Error("Impossible de mettre à jour la demande.");

    if (status === 'accepted') {
        // 2. Créer la conversation privée
        const { data: conv, error: convError } = await supabase
            .from('conversations')
            .insert([{ is_group: false, name: null }]) // is_group false = privé
            .select()
            .single();
            
        if (convError || !conv) throw new Error("Erreur lors de la création du chat.");
            
        // 3. Ajouter les participants
        const { error: partError } = await supabase.from('participants').insert([
            { conversation_id: conv.id, user_id: request.sender_id },
            { conversation_id: conv.id, user_id: request.receiver_id }
        ]);

        if (partError) throw partError;
        
        // 4. Message d'accueil système
        await sendMessageAPI(conv.id, request.receiver_id, "👋 Demande d'ami acceptée ! Vous pouvez discuter.");
        
        return conv as Conversation;
    }
    return null;
};

export const deleteConversationAPI = async (conversationId: string): Promise<boolean> => {
    if (!supabase) return false;
    const { error } = await supabase.from('conversations').delete().eq('id', conversationId);
    return !error;
};

export const getOtherParticipant = async (conversationId: string, currentUserId: string): Promise<User | undefined> => {
    if (!supabase) return undefined;
    
    const { data } = await supabase
        .from('participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', currentUserId)
        .single();
        
    if (data) {
        return await getUserByIdAPI(data.user_id);
    }
    return undefined;
};

// --- REALTIME SUBSCRIPTIONS ---

// Écouter les nouveaux messages d'une conversation
export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    if (!supabase) return () => {};

    const channel = supabase
        .channel(`room:${conversationId}`)
        .on(
            'postgres_changes', 
            { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages', 
                filter: `conversation_id=eq.${conversationId}` 
            }, 
            async (payload) => {
                const newMsg = payload.new as Message;
                const sender = await getUserByIdAPI(newMsg.sender_id);
                onMessage({
                    ...newMsg,
                    sender_username: sender ? `${sender.username}#${sender.tag}` : '...'
                });
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
};

// Écouter les demandes d'amis entrantes (POUR LE DASHBOARD)
export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    if (!supabase) return () => {};

    const channel = supabase
        .channel(`requests:${userId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'friend_requests',
                filter: `receiver_id=eq.${userId}` // Uniquement les demandes reçues
            },
            (payload) => {
                if (payload.new.status === 'pending') {
                    onNewRequest();
                }
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
};