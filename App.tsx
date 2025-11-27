import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/Auth/AuthScreen';
import { ConversationList } from './components/Chat/ConversationList';
import { ChatWindow } from './components/Chat/ChatWindow';
import { Conversation, FriendRequest, User } from './types';
import { 
  getConversationsAPI, deleteConversationAPI, sendFriendRequestAPI, 
  getIncomingFriendRequestsAPI, respondToFriendRequestAPI, subscribeToFriendRequests, 
  subscribeToConversationsList, getContactsAPI, createGroupConversationAPI, 
  getOnlineUsersAPI, subscribeToUserStatus
} from './services/api';
import { usePushNotifications } from './hooks/usePushNotifications';
import { MessageCircle, UserPlus, Bell, Check, X, LogOut, Copy, RefreshCw, Users, Moon, Sun, Plus } from 'lucide-react';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { motion, AnimatePresence } from 'framer-motion';

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

  const [isFriendModalOpen, setIsFriendModalOpen] = useState(false);
  const [newChatTarget, setNewChatTarget] = useState('');
  const [friendModalLoading, setFriendModalLoading] = useState(false);
  const [friendModalError, setFriendModalError] = useState('');
  const [friendModalSuccess, setFriendModalSuccess] = useState('');

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [contacts, setContacts] = useState<User[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  usePushNotifications(user?.id);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };

  const fetchConversations = async () => {
      if(!user) return;
      try { setConversations(await getConversationsAPI(user.id)); } catch (e) { console.error(e); }
  };

  const fetchRequests = async () => {
      if(!user) return;
      try {
          const reqs = await getIncomingFriendRequestsAPI(user.id);
          setFriendRequests(reqs);
          setUnreadNotifsCount(reqs.filter(r => r.status === 'pending').length);
      } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!user) return;
    const init = async () => {
        setLoading(true);
        await Promise.all([fetchConversations(), fetchRequests()]);
        const onlineIds = await getOnlineUsersAPI();
        setOnlineUsers(new Set(onlineIds));
        setLoading(false);
    };
    init();

    const unsubReq = subscribeToFriendRequests(user.id, fetchRequests);
    const unsubConv = subscribeToConversationsList(fetchConversations);
    
    // Status update logic
    const unsubStatus = subscribeToUserStatus((uid, online) => {
        setOnlineUsers(prev => { 
            const n = new Set(prev); 
            if (online) {
                n.add(uid);
            } else {
                n.delete(uid); 
            }
            return n; 
        });
    });

    return () => { unsubReq(); unsubConv(); unsubStatus(); };
  }, [user, token]);

  const handleCreateGroup = async (e: React.FormEvent) => {
      e.preventDefault();
      const res = await createGroupConversationAPI(groupName, selectedContacts);
      setIsGroupModalOpen(false); setGroupName(''); setSelectedContacts([]);
      fetchConversations(); setActiveConversationId(res.conversationId);
  };

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <div className="flex h-[100dvh] w-full bg-gray-50 dark:bg-gray-950 overflow-hidden relative">
      
      {/* Modals Overlay */}
      <AnimatePresence>
        {(isFriendModalOpen || isGroupModalOpen) && (
            <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                onClick={() => { setIsFriendModalOpen(false); setIsGroupModalOpen(false); }}
            >
                <motion.div 
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
                                <Input label="Identifiant (Nom#1234)" value={newChatTarget} onChange={e => setNewChatTarget(e.target.value)} autoFocus />
                                {friendModalError && <div className="text-red-500 text-sm mb-4">{friendModalError}</div>}
                                {friendModalSuccess && <div className="text-green-500 text-sm mb-4">{friendModalSuccess}</div>}
                                <Button type="submit" isLoading={friendModalLoading}>Envoyer la demande</Button>
                            </form>
                        </>
                    ) : (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold dark:text-white flex items-center gap-2"><Users className="text-brand-500"/> Nouveau Groupe</h2>
                                <button onClick={() => setIsGroupModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X /></button>
                            </div>
                            <form onSubmit={handleCreateGroup} className="flex flex-col h-[60vh]">
                                <Input label="Nom du groupe" value={groupName} onChange={e => setGroupName(e.target.value)} required />
                                <div className="flex-1 overflow-y-auto border dark:border-gray-700 rounded-xl p-2 my-2 bg-gray-50 dark:bg-gray-800/50">
                                    {contacts.map(contact => (
                                        <div key={contact.id} onClick={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(x => x !== contact.id) : [...prev, contact.id])}
                                            className={`flex items-center p-3 rounded-lg cursor-pointer mb-1 transition-colors ${selectedContacts.includes(contact.id) ? 'bg-brand-50 dark:bg-brand-900/30 ring-1 ring-brand-500' : 'hover:bg-white dark:hover:bg-gray-700'}`}
                                        >
                                            <div className={`w-5 h-5 rounded border mr-3 flex items-center justify-center ${selectedContacts.includes(contact.id) ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-300'}`}>
                                                {selectedContacts.includes(contact.id) && <Check size={14} />}
                                            </div>
                                            <span className="dark:text-gray-200">{contact.username}</span>
                                        </div>
                                    ))}
                                </div>
                                <Button type="submit" disabled={!groupName || selectedContacts.length === 0}>Créer ({selectedContacts.length})</Button>
                            </form>
                        </>
                    )}
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div className={`${activeConversationId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[380px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-10 transition-all`}>
        {/* User Header */}
        <div className="h-[70px] px-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigator.clipboard.writeText(`${user?.username}#${user?.tag}`)}>
                <div className="h-10 w-10 bg-gradient-to-tr from-brand-500 to-brand-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-brand-500/20 group-hover:scale-105 transition-transform">
                    {user?.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col">
                    <span className="font-bold text-gray-900 dark:text-white text-sm">{user?.username}</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-md">
                        #{user?.tag} <Copy size={8} />
                    </span>
                </div>
            </div>
            <div className="flex gap-1">
                <button onClick={toggleTheme} className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
                    {isDarkMode ? <Sun size={20}/> : <Moon size={20}/>}
                </button>
                <div className="relative">
                    <button onClick={() => setShowNotifications(!showNotifications)} className={`p-2.5 rounded-xl transition-colors relative ${showNotifications ? 'bg-brand-50 text-brand-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'}`}>
                        <Bell size={20} />
                        {unreadNotifsCount > 0 && <span className="absolute top-2 right-2 h-2.5 w-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
                    </button>
                    <AnimatePresence>
                    {showNotifications && (
                        <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }} 
                            animate={{ opacity: 1, y: 0, scale: 1 }} 
                            exit={{ opacity: 0, y: 10, scale: 0.95 }} 
                            className="absolute right-0 mt-3 w-72 max-w-[90vw] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 z-50 overflow-hidden origin-top-right"
                        >
                            <div className="p-3 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700 flex justify-between items-center">
                                <span className="text-xs font-bold uppercase text-gray-500">Notifications</span>
                                <button onClick={fetchRequests}><RefreshCw size={14} className="text-gray-400" /></button>
                            </div>
                            <div className="max-h-64 overflow-y-auto p-2">
                                {friendRequests.length === 0 ? <p className="text-center text-xs text-gray-400 py-4">Rien à signaler</p> : 
                                    friendRequests.map(req => (
                                        <div key={req.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl mb-2">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="font-semibold text-sm dark:text-white">{req.sender?.username}</span>
                                                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{req.status}</span>
                                            </div>
                                            {req.status === 'pending' && (
                                                <div className="flex gap-2">
                                                    <button onClick={() => respondToFriendRequestAPI(req.id, 'accepted').then(fetchRequests)} className="flex-1 bg-brand-500 text-white text-xs py-1.5 rounded-lg">Accepter</button>
                                                    <button onClick={() => respondToFriendRequestAPI(req.id, 'rejected').then(fetchRequests)} className="flex-1 bg-gray-200 text-gray-700 text-xs py-1.5 rounded-lg">Refuser</button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                }
                            </div>
                        </motion.div>
                    )}
                    </AnimatePresence>
                </div>
                <button onClick={logout} className="p-2.5 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"><LogOut size={20} /></button>
            </div>
        </div>

        {/* Quick Actions */}
        <div className="p-3 grid grid-cols-2 gap-2">
             <button onClick={() => setIsFriendModalOpen(true)} className="flex items-center justify-center gap-2 bg-gray-50 hover:bg-white border border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 dark:text-gray-200 p-2.5 rounded-xl text-sm font-medium transition-all shadow-sm">
                <UserPlus size={16} className="text-brand-500" /> Ajouter Ami
             </button>
             <button onClick={() => { openGroupModal(); }} className="flex items-center justify-center gap-2 bg-gray-50 hover:bg-white border border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 dark:text-gray-200 p-2.5 rounded-xl text-sm font-medium transition-all shadow-sm">
                <Users size={16} className="text-blue-500" /> Créer Groupe
             </button>
        </div>

        {/* List */}
        {loading ? (
            <div className="flex-1 flex justify-center pt-10"><div className="w-8 h-8 border-2 border-brand-500 rounded-full border-t-transparent animate-spin"></div></div>
        ) : (
            <ConversationList 
                conversations={conversations} 
                activeId={activeConversationId} 
                onSelect={setActiveConversationId}
                onDelete={async (id) => { await deleteConversationAPI(id, user!.id); fetchConversations(); if(activeConversationId === id) setActiveConversationId(null); }}
                currentUser={user!}
                onlineUsers={onlineUsers}
            />
        )}
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-gray-950 relative z-0 ${!activeConversationId ? 'hidden md:flex' : 'flex'}`}>
        {activeConversation ? (
            <ChatWindow conversation={activeConversation} currentUser={user!} onlineUsers={onlineUsers} onBack={() => setActiveConversationId(null)} />
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 pattern-bg">
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-2xl shadow-brand-500/10 mb-6">
                    <div className="h-20 w-20 bg-gradient-to-br from-brand-400 to-brand-600 rounded-2xl flex items-center justify-center shadow-lg">
                        <MessageCircle size={40} className="text-white" />
                    </div>
                </motion.div>
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Bienvenue sur Evo</h3>
                <p className="text-gray-500 mt-2 max-w-xs text-center">Une expérience de messagerie fluide et moderne. Sélectionnez une conversation.</p>
            </div>
        )}
      </div>

      {/* Group Modal Logic Helper */}
      {/* (Moved logic inside the modal renderer above to keep JSX clean) */}
    </div>
  );

  function openGroupModal() { setIsGroupModalOpen(true); getContactsAPI().then(res => { const u = Array.from(new Map(res.map(f => [f.id, f])).values()); setContacts(u); }); }
};

const AuthWrapper = () => {
    const { user, isLoading } = useAuth();
    if (isLoading) return <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950"><div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>;
    return user ? <Dashboard /> : <AuthScreen />;
}

const App = () => <AuthProvider><AuthWrapper /></AuthProvider>;

export default App;