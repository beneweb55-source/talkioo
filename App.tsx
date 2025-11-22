import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/Auth/AuthScreen';
import { ConversationList } from './components/Chat/ConversationList';
import { ChatWindow } from './components/Chat/ChatWindow';
import { Conversation, FriendRequest, User } from './types';
import { 
  getConversationsAPI, 
  deleteConversationAPI, 
  sendFriendRequestAPI, 
  getIncomingFriendRequestsAPI,
  respondToFriendRequestAPI,
  subscribeToFriendRequests,
  subscribeToConversationsList,
  getContactsAPI,
  createGroupConversationAPI,
  getOnlineUsersAPI,
  subscribeToUserStatus
} from './services/api';
import { usePushNotifications } from './hooks/usePushNotifications';
import { MessageCircleCode, UserPlus, Bell, Check, X as XIcon, LogOut, X, Copy, RefreshCw, Users, Moon, Sun } from 'lucide-react';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';

const Dashboard = () => {
  const { user, logout, token } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);
  const [refreshingNotifs, setRefreshingNotifs] = useState(false);

  const [isFriendModalOpen, setIsFriendModalOpen] = useState(false);
  const [newChatTarget, setNewChatTarget] = useState('');
  const [friendModalLoading, setFriendModalLoading] = useState(false);
  const [friendModalError, setFriendModalError] = useState('');
  const [friendModalSuccess, setFriendModalSuccess] = useState('');

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<User[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);

  // --- ACTIVATE PUSH NOTIFICATIONS ---
  usePushNotifications(user?.id);
  // -----------------------------------

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
  };

  const fetchConversations = async () => {
      if(!user) return;
      try {
          const convs = await getConversationsAPI(user.id);
          setConversations(convs);
      } catch (e) {
          console.error("Error fetching conversations", e);
      }
  };

  const fetchRequests = async () => {
      if(!user) return;
      setRefreshingNotifs(true);
      try {
          const reqs = await getIncomingFriendRequestsAPI(user.id);
          setFriendRequests(reqs);
          const pendingCount = reqs.filter(r => r.status === 'pending').length;
          setUnreadNotifsCount(pendingCount);
      } catch (e) {
          console.error("Error fetching requests", e);
      } finally {
          setRefreshingNotifs(false);
      }
  };

  const fetchContacts = async () => {
      try {
          const friends = await getContactsAPI();
          // Ensure uniqueness just in case
          const uniqueFriends = Array.from(new Map(friends.map(f => [f.id, f])).values());
          setContacts(uniqueFriends);
      } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!user) return;

    const init = async () => {
        setLoading(true);
        await Promise.all([fetchConversations(), fetchRequests(), fetchContacts()]);
        const online = await getOnlineUsersAPI();
        setOnlineUsers(new Set(online));
        setLoading(false);
    };
    init();

    const unsubscribeRequests = subscribeToFriendRequests(user.id, () => {
        fetchRequests();
    });

    const unsubscribeConvs = subscribeToConversationsList(() => {
        fetchConversations();
    });

    const unsubscribeStatus = subscribeToUserStatus((userId, isOnline) => {
        // 1. Update Online Users SET (Used by ConversationList)
        setOnlineUsers(prev => {
            const next = new Set(prev);
            if (isOnline) next.add(userId);
            else next.delete(userId);
            return next;
        });

        // 2. Update Contacts List State (Explicitly requested)
        setContacts(prevContacts => prevContacts.map(c => 
            c.id === userId ? { ...c, is_online: isOnline } : c
        ));
    });

    return () => {
        unsubscribeRequests();
        unsubscribeConvs();
        unsubscribeStatus();
    };
  }, [user, token]);

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFriendModalLoading(true);
    setFriendModalError('');
    setFriendModalSuccess('');

    try {
        const response = await sendFriendRequestAPI(user.id, newChatTarget);
        
        if (response && response.conversationId) {
             setFriendModalSuccess("Ami ajouté mutuellement !");
             await fetchConversations();
             setTimeout(() => { setIsFriendModalOpen(false); setFriendModalSuccess(''); setNewChatTarget(''); }, 1500);
        } else {
             setFriendModalSuccess(`Demande envoyée à ${newChatTarget} !`);
             setNewChatTarget('');
             setTimeout(() => { setIsFriendModalOpen(false); setFriendModalSuccess(''); }, 2000);
        }
    } catch (err: any) {
        setFriendModalError(err.message || "Erreur");
    } finally {
        setFriendModalLoading(false);
    }
  };

  const handleRespondToRequest = async (requestId: string, status: 'accepted' | 'rejected') => {
      try {
        setFriendRequests(prev => prev.filter(r => r.id !== requestId));
        setUnreadNotifsCount(prev => Math.max(0, prev - 1));
        await respondToFriendRequestAPI(requestId, status);
        if (status === 'accepted') {
            fetchConversations();
            fetchContacts(); // Reload contacts on accept
        }
      } catch (err) {
          console.error("Erreur réponse demande", err);
          fetchRequests();
      }
  };

  const openGroupModal = async () => {
      setIsGroupModalOpen(true);
      // Contacts are already fetched in init(), we just open the modal.
      // Optionally we could refresh silently:
      // fetchContacts(); 
  };

  const toggleContact = (id: string) => {
      setSelectedContacts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!groupName.trim() || selectedContacts.length === 0) return;

      setGroupLoading(true);
      try {
          const res = await createGroupConversationAPI(groupName, selectedContacts);
          setIsGroupModalOpen(false);
          setGroupName('');
          setSelectedContacts([]);
          await fetchConversations();
          setActiveConversationId(res.conversationId);
      } catch (e) {
          alert("Erreur création groupe");
      } finally {
          setGroupLoading(false);
      }
  };

  const handleDeleteConversation = async (id: string) => {
      if (!user) return;
      const success = await deleteConversationAPI(id, user.id);
      if (success) {
          if (activeConversationId === id) setActiveConversationId(null);
          fetchConversations();
      }
  };

  const copyToClipboard = () => {
      if(user) navigator.clipboard.writeText(`${user.username}#${user.tag}`);
  };

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <div className="flex h-[100dvh] w-full bg-gray-100 dark:bg-gray-900 overflow-hidden relative font-sans text-gray-900 dark:text-gray-100">
      {isFriendModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200 border border-gray-100 dark:border-gray-700">
                <button onClick={() => setIsFriendModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={24} /></button>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600 dark:text-orange-400"><UserPlus size={24} /></div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Ajouter un contact</h2>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Entrez l'identifiant unique <b>Nom#1234</b>.</p>
                <form onSubmit={handleSendFriendRequest}>
                    <Input label="Identifiant Talkio" placeholder="ex: Alice#1234" value={newChatTarget} onChange={(e) => setNewChatTarget(e.target.value)} autoFocus className="text-lg" />
                    {friendModalError && <div className="mb-4 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded flex items-center gap-2"><XIcon size={16} /> {friendModalError}</div>}
                    {friendModalSuccess && <div className="mb-4 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 p-3 rounded flex items-center gap-2"><Check size={16} /> {friendModalSuccess}</div>}
                    <div className="flex justify-end gap-3 mt-6">
                        <Button type="button" variant="secondary" className="w-auto" onClick={() => setIsFriendModalOpen(false)}>Annuler</Button>
                        <Button type="submit" className="w-auto" isLoading={friendModalLoading}>Envoyer</Button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {isGroupModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200 h-[80vh] flex flex-col border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                        <Users className="text-orange-600" /> Nouveau Groupe
                    </h2>
                    <button onClick={() => setIsGroupModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X size={24} /></button>
                </div>
                
                <form onSubmit={handleCreateGroup} className="flex-1 flex flex-col overflow-hidden">
                    <Input 
                        label="Nom du groupe" 
                        placeholder="ex: Équipe Projet" 
                        value={groupName} 
                        onChange={(e) => setGroupName(e.target.value)} 
                        required 
                    />
                    
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 mt-2">Participants</label>
                    <div className="flex-1 overflow-y-auto border dark:border-gray-600 rounded-md p-2 bg-gray-50 dark:bg-gray-700/30">
                        {groupLoading ? (
                            <div className="text-center p-4 dark:text-gray-400">Chargement...</div>
                        ) : contacts.length === 0 ? (
                            <div className="text-center p-4 text-gray-500 dark:text-gray-400">Aucun ami trouvé.</div>
                        ) : (
                            contacts.map(contact => (
                                <div 
                                    key={contact.id} 
                                    onClick={() => toggleContact(contact.id)}
                                    className={`flex items-center p-3 rounded-lg cursor-pointer mb-1 transition-colors ${selectedContacts.includes(contact.id) ? 'bg-orange-100 dark:bg-orange-900/50 border border-orange-300 dark:border-orange-700' : 'hover:bg-white dark:hover:bg-gray-700 border border-transparent'}`}
                                >
                                    <div className={`w-5 h-5 rounded border mr-3 flex items-center justify-center ${selectedContacts.includes(contact.id) ? 'bg-orange-500 border-orange-500' : 'border-gray-400 bg-white dark:bg-gray-600 dark:border-gray-500'}`}>
                                        {selectedContacts.includes(contact.id) && <Check size={14} className="text-white" />}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-medium dark:text-gray-200 flex items-center gap-2">
                                            {contact.username}
                                            {contact.is_online && <span className="w-2 h-2 bg-green-500 rounded-full" title="En ligne"></span>}
                                        </span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">#{contact.tag}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="pt-4 mt-auto">
                        <Button type="submit" disabled={selectedContacts.length === 0 || !groupName.trim()}>
                            Créer le groupe ({selectedContacts.length})
                        </Button>
                    </div>
                </form>
            </div>
        </div>
      )}

      <div className="w-[350px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col z-10 shadow-sm flex-shrink-0">
        <div className="h-16 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-900 shrink-0">
            <div className="flex items-center gap-2 overflow-hidden cursor-pointer group" onClick={copyToClipboard} title="Copier mon ID">
                <div className="h-9 w-9 bg-orange-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm group-hover:scale-105 transition-transform">
                    {user?.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col overflow-hidden">
                    <span className="font-semibold text-gray-800 dark:text-gray-100 truncate text-sm">{user?.username}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        #{user?.tag} <Copy size={8} className="opacity-0 group-hover:opacity-100" />
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-1">
                <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors">
                    {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                </button>

                <div className="relative">
                    <button onClick={() => setShowNotifications(!showNotifications)} className={`p-2 rounded-full transition-colors relative ${showNotifications ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        <Bell size={20} />
                        {unreadNotifsCount > 0 && (
                            <span className="absolute top-1 right-1 h-2.5 w-2.5 bg-red-500 rounded-full border-2 border-white dark:border-gray-900"></span>
                        )}
                    </button>

                    {showNotifications && (
                        <div className="absolute left-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 origin-top-left">
                            <div className="p-3 border-b border-gray-50 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                                <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-200">Notifications</h3>
                                <button onClick={fetchRequests} disabled={refreshingNotifs}><RefreshCw size={14} className={`text-gray-400 ${refreshingNotifs ? 'animate-spin' : ''}`} /></button>
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {friendRequests.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-gray-400">Aucune nouvelle notification</div>
                                ) : (
                                    friendRequests.map(req => (
                                        <div key={req.id} className="p-3 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="font-medium text-sm text-gray-800 dark:text-gray-200">{req.sender?.username}<span className="text-gray-400 text-xs">#{req.sender?.tag}</span></div>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${req.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600'}`}>
                                                    {req.status === 'pending' ? 'Demande' : req.status}
                                                </span>
                                            </div>
                                            {req.status === 'pending' && (
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleRespondToRequest(req.id, 'accepted')} className="flex-1 bg-orange-600 text-white text-xs py-1.5 rounded hover:bg-orange-700 transition-colors">Accepter</button>
                                                    <button onClick={() => handleRespondToRequest(req.id, 'rejected')} className="flex-1 bg-gray-200 text-gray-700 text-xs py-1.5 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors">Refuser</button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
                
                <button onClick={logout} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors" title="Déconnexion">
                    <LogOut size={20} />
                </button>
            </div>
        </div>

        <div className="px-4 py-2 flex gap-2">
             <button onClick={() => setIsFriendModalOpen(true)} className="flex-1 flex items-center justify-center gap-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 py-2 rounded-lg text-sm font-medium hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors border border-orange-200 dark:border-orange-800 dashed">
                <UserPlus size={16} /> Ami
             </button>
             <button onClick={openGroupModal} className="flex-1 flex items-center justify-center gap-2 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-700">
                <Users size={16} /> Groupe
             </button>
        </div>

        {loading ? (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600"></div>
            </div>
        ) : (
            <ConversationList 
                conversations={conversations} 
                activeId={activeConversationId} 
                onSelect={setActiveConversationId}
                onDelete={handleDeleteConversation}
                currentUser={user!}
                onlineUsers={onlineUsers}
            />
        )}
      </div>

      <div className="flex-1 flex flex-col bg-[#e5ddd5] dark:bg-[#0b141a] relative transition-colors duration-300">
        {activeConversation ? (
            <ChatWindow 
                conversation={activeConversation} 
                currentUser={user!} 
                onlineUsers={onlineUsers}
            />
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-[#f0f2f5] dark:bg-[#0b141a] pattern-bg">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-full shadow-sm mb-4">
                    <MessageCircleCode size={48} className="text-orange-300 dark:text-orange-600" />
                </div>
                <h3 className="text-lg font-medium text-gray-600 dark:text-gray-300">Talkio Web</h3>
                <p className="text-sm text-gray-400 mt-2">Sélectionnez une conversation pour commencer.</p>
            </div>
        )}
      </div>
    </div>
  );
};

const AuthWrapper = () => {
    const { user, isLoading } = useAuth();
    if (isLoading) return <div className="h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div></div>;
    return user ? <Dashboard /> : <AuthScreen />;
}

const App = () => {
    return (
        <AuthProvider>
            <AuthWrapper />
        </AuthProvider>
    );
}

export default App;