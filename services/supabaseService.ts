import { supabase } from './supabaseClient';
import { User, Conversation, Message, AuthResponse, FriendRequest } from '../types';

// --- AUTH ---

export const registerAPI = async (username: string, email: string, password: string): Promise<AuthResponse> => {
    if (!supabase) throw new Error("Supabase non configuré");

    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error("Erreur lors de la création du compte");

    // Génération Tag
    const tag = Math.floor(1000 + Math.random() * 9000).toString();
    
    // Insertion Profil
    const { error: profileError } = await supabase
        .from('profiles')
        .insert([{ id: authData.user.id, username, tag, email }]);

    if (profileError) {
        // Ignore si déjà créé par un trigger SQL, sinon log
        console.warn("Profile creation:", profileError);
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

    // 1. Récupérer les IDs de conversation via la table participants
    const { data: participations } = await supabase
        .from('participants')
        .select('conversation_id, last_deleted_at')
        .eq('user_id', userId);

    if (!participations || participations.length === 0) return [];

    // Filtrer celles qui ne sont pas "soft deleted" (supprimées localement)
    // Sauf si un nouveau message est arrivé après la suppression (logique complexe pour MVP, on simplifie ici)
    const activeParticipations = participations; 
    const convIds = activeParticipations.map(p => p.conversation_id);

    // 2. Charger les conversations
    const { data: conversations } = await supabase
        .from('conversations')
        .select('*')
        .in('id', convIds)
        .order('created_at', { ascending: false });
        
    if (!conversations) return [];

    // 3. Récupérer dernier message
    const conversationsWithMsg = await Promise.all(conversations.map(async (c) => {
        const { data: msgs } = await supabase
            .from('messages')
            .select('content, created_at, deleted_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1);
        
        const lastMsg = msgs?.[0];
        let preview = "Nouvelle discussion";
        let time = c.created_at;

        if (lastMsg) {
            preview = lastMsg.deleted_at ? "🚫 Message supprimé" : lastMsg.content;
            time = lastMsg.created_at;
        }

        // Gestion Soft Delete : Si l'utilisateur a supprimé la conv APRES le dernier message, on ne l'affiche pas
        const myPart = activeParticipations.find(p => p.conversation_id === c.id);
        if (myPart?.last_deleted_at && new Date(myPart.last_deleted_at) > new Date(time)) {
            return null; 
        }
            
        return {
            ...c,
            last_message: preview,
            last_message_at: time
        };
    }));

    return conversationsWithMsg.filter(Boolean).sort((a: any, b: any) => 
        new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    ) as Conversation[];
};

export const deleteConversationAPI = async (conversationId: string, userId: string): Promise<boolean> => {
    // Soft Delete : On met à jour last_deleted_at dans la table participants
    const { error } = await supabase
        .from('participants')
        .update({ last_deleted_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

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

    // Insérer le message
    const { data, error } = await supabase
        .from('messages')
        .insert([{ conversation_id: conversationId, sender_id: userId, content }])
        .select()
        .single();

    if (error) throw error;
    
    // Réactiver la conversation pour tous les participants (reset last_deleted_at)
    await supabase
        .from('participants')
        .update({ last_deleted_at: null })
        .eq('conversation_id', conversationId);

    const sender = await getUserByIdAPI(userId);

    return {
        ...data,
        sender_username: sender ? `${sender.username}#${sender.tag}` : 'Moi'
    };
};

export const editMessageAPI = async (messageId: string, newContent: string): Promise<Message> => {
    const { data, error } = await supabase
        .from('messages')
        .update({ content: newContent, updated_at: new Date().toISOString() })
        .eq('id', messageId)
        .select()
        .single();

    if (error) throw error;
    return data as Message;
};

export const deleteMessageAPI = async (messageId: string): Promise<boolean> => {
    const { error } = await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId);
    
    return !error;
};

// --- FRIEND REQUESTS ---

export const sendFriendRequestAPI = async (currentUserId: string, targetIdentifier: string): Promise<boolean> => {
    if (!supabase) return false;

    const parts = targetIdentifier.split('#');
    if (parts.length !== 2) throw new Error("Format attendu : Nom#1234");
    
    const usernameTarget = parts[0].trim();
    const tagTarget = parts[1].trim();

    // Trouver le user cible
    const { data: targetUser, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', usernameTarget)
        .eq('tag', tagTarget)
        .single();

    if (userError || !targetUser) throw new Error(`Utilisateur "${usernameTarget}#${tagTarget}" introuvable.`);
    if (targetUser.id === currentUserId) throw new Error("Vous ne pouvez pas vous ajouter vous-même.");

    // Vérifier relation existante
    const { data: existing } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${targetUser.id}),and(sender_id.eq.${targetUser.id},receiver_id.eq.${currentUserId})`);

    if (existing && existing.length > 0) {
         const pending = existing.find(r => r.status === 'pending');
         const accepted = existing.find(r => r.status === 'accepted');
         
         if (accepted) {
            // Si amis mais conversation supprimée -> la restaurer
            // (Logique simplifiée: on renvoie une erreur pour dire qu'ils sont déjà amis, 
            // mais dans sendMessage, le reset last_deleted_at gère la réapparition)
            throw new Error("Vous êtes déjà amis avec cette personne.");
         }
         if (pending) throw new Error("Une demande d'ami est déjà en attente.");
    }

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
        .select(`*, sender:sender_id (username, tag, email)`)
        .eq('receiver_id', userId)
        .eq('status', 'pending');

    if (error) return [];
    return data.map((r: any) => ({ ...r, sender: { ...r.sender, id: r.sender_id } }));
};

export const respondToFriendRequestAPI = async (requestId: string, status: 'accepted' | 'rejected'): Promise<Conversation | null> => {
    if (!supabase) return null;

    const { data: request, error: updateError } = await supabase
        .from('friend_requests')
        .update({ status })
        .eq('id', requestId)
        .select()
        .single();

    if (updateError || !request) throw new Error("Impossible de mettre à jour la demande.");

    if (status === 'accepted') {
        // Créer conversation
        const { data: conv, error: convError } = await supabase
            .from('conversations')
            .insert([{ is_group: false }])
            .select()
            .single();
            
        if (convError || !conv) throw new Error("Erreur création chat.");
            
        // Ajouter participants
        await supabase.from('participants').insert([
            { conversation_id: conv.id, user_id: request.sender_id },
            { conversation_id: conv.id, user_id: request.receiver_id }
        ]);
        
        // Message système
        await sendMessageAPI(conv.id, request.receiver_id, "👋 Ami accepté !");
        
        return conv as Conversation;
    }
    return null;
};

// --- REALTIME SUBSCRIPTIONS ---

export const subscribeToMessages = (conversationId: string, onMessage: (msg: Message) => void) => {
    if (!supabase) return () => {};

    const channel = supabase
        .channel(`room:${conversationId}`)
        .on(
            'postgres_changes', 
            { 
                event: '*', // Écoute INSERT et UPDATE (pour les modifs/suppressions)
                schema: 'public', 
                table: 'messages', 
                filter: `conversation_id=eq.${conversationId}` 
            }, 
            async (payload) => {
                const newMsg = payload.new as Message;
                // Fetch sender info pour l'affichage propre
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

export const subscribeToFriendRequests = (userId: string, onNewRequest: () => void) => {
    const channel = supabase
        .channel(`requests:${userId}`)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${userId}` },
            (payload) => { if (payload.new.status === 'pending') onNewRequest(); }
        )
        .subscribe();

    return () => { supabase.removeChannel(channel); };
};

export const subscribeToConversationsList = (onUpdate: () => void) => {
    // On simplifie pour le MVP : on recharge si n'importe quel message change
    // Idéalement on filtre sur les conversations de l'user
    const channel = supabase
        .channel(`global_conversations`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => onUpdate())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => onUpdate())
        .subscribe();

    return () => { supabase.removeChannel(channel); };
};
