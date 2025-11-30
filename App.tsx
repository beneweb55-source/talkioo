import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/Auth/AuthScreen';
import { ConversationList } from './components/Chat/ConversationList';
import { ChatWindow } from './components/Chat/ChatWindow';
import { UserProfile } from './components/User/UserProfile';
import { Conversation, FriendRequest, User } from './types';
import { 
  getConversationsAPI, deleteConversationAPI, sendFriendRequestAPI, 
  getIncomingFriendRequestsAPI, respondToFriendRequestAPI, subscribeToFriendRequests, 
  subscribeToConversationsList, getContactsAPI, createGroupConversationAPI, 
  getOnlineUsersAPI, subscribeToUserStatus, subscribeToUserProfileUpdates
} from './services/api';
import { usePushNotifications } from './hooks/usePushNotifications';
import { MessageCircle, UserPlus, Bell, Search, Users, User as UserIcon, Moon, Sun, LogOut, Check, X, RefreshCw, Copy } from 'lucide-react';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { motion, AnimatePresence } from 'framer-motion';

// Casting motion.div to any to bypass strict type checking issues with framer-motion props
const MotionDiv = motion.div as any;

type MobileView = 'chats' | 'contacts' | 'profile';

const Dashboard = () => {
  const { user, logout, login, token } = useAuth();
  
  // Data State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [contacts, setContacts] = useState<User[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  
  // UI State
  const [loading, setLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('chats');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals State
  const [isFriendModalOpen, setIsFriendModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  
  // Notification Modal State
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  // Forms State
  const [newChatTarget, setNewChatTarget] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [friendModalLoading, setFriendModalLoading] = useState(false);
  const [friendModalError, setFriendModalError] = useState('');
  const [friendModalSuccess, setFriendModalSuccess] = useState('');

  const { permission, requestPermission } = usePushNotifications(user?.id);

  useEffect(() => {
    // Check if user has already dismissed or made a choice
    const dismissed = localStorage.getItem('talkio_notifications_dismissed');
    
    // Only show if browser supports it, permission is default (not yet chosen), and not dismissed
    if ('Notification' in window && permission === 'default' && !dismissed) {
        // Small delay for better UX
        const timer = setTimeout(() => setShowNotificationModal(true), 3000);
        return () => clearTimeout(timer);
    }
  }, [permission]);

  const handleEnableNotifications = () => {
      requestPermission();
      setShowNotificationModal(false);
  };

  const handleDismissNotifications = () => {
      localStorage.setItem('talkio_notifications_dismissed', 'true');
      setShowNotificationModal(false);
  };

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const fetchData = async () => {
      if(!user) return;
      try {
          const [convs, reqs, users, online] = await Promise.all([
              getConversationsAPI(user.id),
              getIncomingFriendRequestsAPI(user.id),
              getContactsAPI(),
              getOnlineUsersAPI()
          ]);
          setConversations(convs);
          setFriendRequests(reqs);
          // Deduplicate contacts
          const uniqueContacts = Array.from(new Map(users.map(u => [u.id, u])).values());
          setContacts(uniqueContacts);
          setOnlineUsers(new Set(online));
      } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchData().finally(() => setLoading(false));

    const unsubReq = subscribeToFriendRequests(user.id, fetchData);
    const unsubConv = subscribeToConversationsList(fetchData);
    const unsubStatus = subscribeToUserStatus((uid, online) => {
        setOnlineUsers(prev => { 
            const n = new Set(prev); 
            if (online) n.add(uid); else n.delete(uid); 
            return n; 
        });
    });

    const unsubProfile = subscribeToUserProfileUpdates((updatedUser) => {
        // Update local contact list if present
        setContacts(prev => prev.map(c => c.id === updatedUser.id ? { ...c, ...updatedUser } : c));
        
        // Refresh conversations to update names if necessary
        fetchData();

        // IMPORTANT: If the updated user is ME, update my local session state immediately
        // This ensures the avatar/name updates in the UI (sidebar, profile) without reload
        if (user && updatedUser.id === user.id) {
            login(updatedUser, token || '');
        }
    });

    // AUTO-RELOAD ON FOCUS (Fix desync issues)
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            console.log("App foregrounded: Refreshing data...");
            fetchData();
        }
    };
    
    // Also trigger on window focus for desktop behavior
    const handleWindowFocus = () => {
        fetchData();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => { 
        unsubReq(); unsubConv(); unsubStatus(); unsubProfile(); 
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleWindowFocus);
    };
  }, [user, token]);

  const handleCreateGroup = async (e: React.FormEvent) => {
      e.preventDefault();
      const res = await createGroupConversationAPI(groupName, selectedContacts);
      setIsGroupModalOpen(false); setGroupName(''); setSelectedContacts([]);
      fetchData(); setActiveConversationId(res.conversationId);
  };

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  // --- RENDER HELPERS ---

  const renderContactsView = () => (
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
          {/* Friend Requests Section */}
          {friendRequests.length > 0 && (
              <div className="mb-6">
                  <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Demandes en attente</h3>
                  <div className="space-y-2">
                      {friendRequests.map(req => (
                          <div key={req.id} className="bg-white dark:bg-gray-800 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 bg-brand-100 dark:bg-brand-900/30 text-brand-600 rounded-full flex items-center justify-center font-bold">
                                      {req.sender?.username.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                      <p className="font-semibold text-sm dark:text-white">{req.sender?.username}</p>
                                      <p className="text-xs text-gray-500">Veut être votre ami</p>
                                  </div>
                              </div>
                              <div className="flex gap-2">
                                  <button onClick={() => respondToFriendRequestAPI(req.id, 'accepted').then(fetchData)} className="p-2 bg-brand-500 text-white rounded-full hover:bg-brand-600"><Check size={16}/></button>
                                  <button onClick={() => respondToFriendRequestAPI(req.id, 'rejected').then(fetchData)} className="p-2 bg-gray-200 text-gray-600 rounded-full hover:bg-gray-300"><X size={16}/></button>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          )}

          {/* Contacts List */}
          <div>
              <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-gray-500 uppercase">Mes Contacts ({contacts.length})</h3>
                  <button onClick={() => setIsFriendModalOpen(true)} className="text-brand-600 text-xs font-medium flex items-center gap-1">
                      <UserPlus size={14}/> Ajouter
                  </button>
              </div>
              <div className="space-y-2">
                  {contacts.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">Aucun contact pour le moment.</p>
                  ) : (
                      contacts.map(contact => (
                          <div key={contact.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800/50 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                              <div className="flex items-center gap-3">
                                  <div className="relative">
                                      <div className="h-10 w-10 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 overflow-hidden">
                                          {contact.avatar_url ? (
                                              <img src={contact.avatar_url} alt={contact.username} className="w-full h-full object-cover" />
                                          ) : (
                                              contact.username.charAt(0).toUpperCase()
                                          )}
                                      </div>
                                      {onlineUsers.has(contact.id) && <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-800"></div>}
                                  </div>
                                  <div>
                                      <p className="font-medium text-sm dark:text-gray-200">{contact.username}</p>
                                      <p className="text-xs text-gray-400">#{contact.tag}</p>
                                  </div>
                              </div>
                              <button 
                                  onClick={async () => {
                                      try {
                                          const res = await createGroupConversationAPI("", [contact.id]); 
                                          alert("Pour discuter, utilisez la recherche dans l'onglet 'Chats' ou créez un groupe.");
                                      } catch(e) { console.error(e); }
                                  }}
                                  className="text-gray-400 hover:text-brand-500"
                              >
                                  <MessageCircle size={18} />
                              </button>
                          </div>
                      ))
                  )}
              </div>
          </div>
      </div>
  );

  return (
    <div className="flex h-[100dvh] w-full bg-white dark:bg-gray-950 overflow-hidden relative font-sans">
      
      {/* --- MODALS --- */}
      <AnimatePresence>
        {(isFriendModalOpen || isGroupModalOpen) && (
            <MotionDiv 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                onClick={() => { setIsFriendModalOpen(false); setIsGroupModalOpen(false); }}
            >
                <MotionDiv 
                    initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-800"
                >
                    {isFriendModalOpen ? (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold dark:text-white flex items-center gap-2"><UserPlus className="text-brand-500"/> Ajouter un contact</h2>
                                <button onClick={() => setIsFriendModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X /></button>
                            </div>
                            <form onSubmit={async (e) => {
                                e.preventDefault(); setFriendModalLoading(true); setFriendModalError('');
                                try { await sendFriendRequestAPI(user!.id, newChatTarget); setFriendModalSuccess("Envoyé !"); setTimeout(() => setIsFriendModalOpen(false), 1500); }
                                catch(err: any) { setFriendModalError(err.message); }
                                finally { setFriendModalLoading(false); }
                            }}>
                                <Input label="Identifiant (Nom#1234)" value={newChatTarget} onChange={e => setNewChatTarget(e.target.value)} autoFocus placeholder="Ex: Alex#1234" />
                                {friendModalError && <div className="text-red-500 text-sm mb-4 bg-red-50 p-2 rounded">{friendModalError}</div>}
                                {friendModalSuccess && <div className="text-green-500 text-sm mb-4 bg-green-50 p-2 rounded">{friendModalSuccess}</div>}
                                <Button type="submit" isLoading={friendModalLoading}>Envoyer la demande</Button>
                            </form>
                        </>
                    ) : (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold dark:text-white flex items-center gap-2"><Users className="text-brand-500"/> Nouveau Groupe</h2>
                                <button onClick={() => setIsGroupModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X /></button>
                            </div>
                            <form onSubmit={handleCreateGroup} className="flex flex-col h-[50vh]">
                                <Input label="Nom du groupe" value={groupName} onChange={e => setGroupName(e.target.value)} required placeholder="Ex: Team Projet" />
                                <label className="text-xs font-semibold uppercase text-gray-500 mt-2 mb-1">Participants</label>
                                <div className="flex-1 overflow-y-auto border border-gray-100 dark:border-gray-700 rounded-xl p-2 bg-gray-50 dark:bg-gray-800/50">
                                    {contacts.length === 0 && <p className="text-center text-gray-400 text-sm mt-4">Aucun contact disponible.</p>}
                                    {contacts.map(contact => (
                                        <div key={contact.id} onClick={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(x => x !== contact.id) : [...prev, contact.id])}
                                            className={`flex items-center p-3 rounded-lg cursor-pointer mb-1 transition-colors ${selectedContacts.includes(contact.id) ? 'bg-brand-50 dark:bg-brand-900/30 ring-1 ring-brand-500' : 'hover:bg-white dark:hover:bg-gray-700'}`}
                                        >
                                            <div className={`w-5 h-5 rounded border mr-3 flex items-center justify-center transition-colors ${selectedContacts.includes(contact.id) ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                                                {selectedContacts.includes(contact.id) && <Check size={14} />}
                                            </div>
                                            <span className="dark:text-gray-200 text-sm">
                                                {contact.username}
                                                <span className="text-gray-500 text-xs ml-1">#{contact.tag}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4">
                                    <Button type="submit" disabled={!groupName || selectedContacts.length === 0}>Créer le groupe ({selectedContacts.length})</Button>
                                </div>
                            </form>
                        </>
                    )}
                </MotionDiv>
            </MotionDiv>
        )}
      </AnimatePresence>

      {/* --- NOTIFICATION PERMISSION MODAL --- */}
      <AnimatePresence>
        {showNotificationModal && (
            <MotionDiv 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed bottom-4 right-4 z-[100] bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 max-w-sm"
            >
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-brand-100 dark:bg-brand-900/30 rounded-full text-brand-600">
                        <Bell size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900 dark:text-white text-sm">Activer les notifications ?</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3 leading-relaxed">
                            Ne ratez aucun message important lorsque vous n'êtes pas sur l'application.
                        </p>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleEnableNotifications} 
                                className="px-3 py-1.5 text-xs font-semibold bg-brand-500 text-white rounded-lg hover:bg-brand-600 transition-colors shadow-sm"
                            >
                                Activer
                            </button>
                            <button 
                                onClick={handleDismissNotifications} 
                                className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                                Plus tard
                            </button>
                        </div>
                    </div>
                    <button onClick={handleDismissNotifications} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X size={16} />
                    </button>
                </div>
            </MotionDiv>
        )}
      </AnimatePresence>

      {/* --- SIDEBAR / MOBILE MAIN VIEW --- */}
      <div className={`
        flex-col w-full md:w-[380px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-10 transition-all duration-300
        ${activeConversationId ? 'hidden md:flex' : 'flex'}
      `}>
        
        {/* Header (Search & User & Tabs) */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md sticky top-0 z-20">
            <div className="flex flex-col gap-3 mb-2">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3 group cursor-pointer" onClick={() => setMobileView('profile')}>
                        <div className="h-9 w-9 bg-gradient-to-tr from-brand-500 to-brand-600 rounded-xl flex items-center justify-center text-white font-bold shadow-md overflow-hidden">
                            {user?.avatar_url ? (
                                <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                            ) : (
                                user?.username.charAt(0).toUpperCase()
                            )}
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{user?.username}</h1>
                             <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> En ligne
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={toggleTheme} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                            {isDarkMode ? <Sun size={18}/> : <Moon size={18}/>}
                        </button>
                        <button onClick={() => setIsGroupModalOpen(true)} className="p-2 rounded-lg bg-brand-50 dark:bg-brand-900/30 text-brand-600 hover:bg-brand-100 transition-colors">
                            <Users size={18} />
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs (Hidden on Mobile, Visible on Desktop) */}
                <div className="hidden md:flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
                    <button 
                        onClick={() => setMobileView('chats')} 
                        className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${mobileView === 'chats' ? 'bg-white dark:bg-gray-700 shadow-sm text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                        Discussions
                    </button>
                    <button 
                        onClick={() => setMobileView('contacts')} 
                        className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all relative ${mobileView === 'contacts' ? 'bg-white dark:bg-gray-700 shadow-sm text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                        Contacts
                        {friendRequests.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>}
                    </button>
                </div>
            </div>

            {/* Global Search Bar (Only shown in chats or contacts) */}
            {mobileView !== 'profile' && (
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input 
                        type="text" 
                        placeholder={mobileView === 'contacts' ? "Rechercher un contact..." : "Rechercher une discussion..."}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-100 dark:bg-gray-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:bg-white dark:focus:bg-gray-800/80 transition-all outline-none dark:text-white placeholder-gray-500"
                    />
                </div>
            )}
        </div>

        {/* Content Area */}
        {mobileView === 'chats' && (
            loading ? (
                <div className="flex-1 flex justify-center pt-10"><div className="w-8 h-8 border-2 border-brand-500 rounded-full border-t-transparent animate-spin"></div></div>
            ) : (
                <ConversationList 
                    conversations={conversations} 
                    activeId={activeConversationId} 
                    onSelect={setActiveConversationId}
                    onDelete={async (id) => { await deleteConversationAPI(id, user!.id); fetchData(); if(activeConversationId === id) setActiveConversationId(null); }}
                    currentUser={user!}
                    onlineUsers={onlineUsers}
                    searchTerm={searchTerm} // Pass search term
                />
            )
        )}

        {mobileView === 'contacts' && renderContactsView()}

        {mobileView === 'profile' && (
            <div className="flex-1 overflow-y-auto">
                <UserProfile onClose={() => setMobileView('chats')} />
                <div className="p-4">
                    <Button variant="ghost" onClick={logout} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 w-full justify-start">
                        <LogOut size={18} /> Déconnexion
                    </Button>
                </div>
            </div>
        )}

        {/* Bottom Navigation (Mobile Only - Simplified to match Sidebar tabs) */}
        <div className="md:hidden h-16 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center justify-around px-2 z-30 pb-safe fixed bottom-0 left-0 w-full backdrop-blur-lg bg-white/90 dark:bg-gray-900/90">
            <button 
                onClick={() => setMobileView('chats')} 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl w-16 transition-all ${mobileView === 'chats' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400'}`}
            >
                <MessageCircle size={24} strokeWidth={mobileView === 'chats' ? 2.5 : 2} />
                <span className="text-[10px] font-medium">Chats</span>
            </button>
            <button 
                onClick={() => setMobileView('contacts')} 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl w-16 transition-all relative ${mobileView === 'contacts' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400'}`}
            >
                <div className="relative">
                    <Users size={24} strokeWidth={mobileView === 'contacts' ? 2.5 : 2} />
                    {friendRequests.length > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-gray-900"></span>}
                </div>
                <span className="text-[10px] font-medium">Contacts</span>
            </button>
            <button 
                onClick={() => setMobileView('profile')} 
                className={`flex flex-col items-center gap-1 p-2 rounded-xl w-16 transition-all ${mobileView === 'profile' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-400'}`}
            >
                <UserIcon size={24} strokeWidth={mobileView === 'profile' ? 2.5 : 2} />
                <span className="text-[10px] font-medium">Profil</span>
            </button>
        </div>
      </div>

      {/* --- MAIN CHAT WINDOW (Desktop & Active Mobile) --- */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-gray-950 relative z-0 ${!activeConversationId ? 'hidden md:flex' : 'flex'}`}>
        {activeConversation ? (
            <ChatWindow 
                conversation={activeConversation} 
                currentUser={user!} 
                onlineUsers={onlineUsers} 
                contacts={contacts} // PASS CONTACTS HERE
                onBack={() => setActiveConversationId(null)} 
            />
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 pattern-bg">
                <MotionDiv initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-2xl shadow-brand-500/10 mb-6">
                    <div className="h-20 w-20 bg-gradient-to-br from-brand-400 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <MessageCircle size={40} className="text-white" />
                    </div>
                </MotionDiv>
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Bienvenue sur Evo Me</h3>
                <p className="text-gray-500 mt-2 max-w-xs text-center">Une expérience de messagerie fluide et moderne. Sélectionnez une conversation pour commencer.</p>
            </div>
        )}
      </div>
    </div>
  );
};

const AuthWrapper = () => {
    const { user, isLoading } = useAuth();
    if (isLoading) return <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950"><div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>;
    return user ? <Dashboard /> : <AuthScreen />;
}

const App = () => <AuthProvider><AuthWrapper /></AuthProvider>;

export default App;