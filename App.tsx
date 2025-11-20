import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/Auth/AuthScreen';
import { ConversationList } from './components/Chat/ConversationList';
import { ChatWindow } from './components/Chat/ChatWindow';
import { Conversation, FriendRequest } from './types';
import { 
  getConversationsAPI, 
  deleteConversationAPI, 
  sendFriendRequestAPI, 
  getIncomingFriendRequestsAPI,
  respondToFriendRequestAPI,
  subscribeToFriendRequests
} from './services/supabaseService';
import { MessageCircleCode, UserPlus, Bell, Check, X as XIcon, LogOut, X, Copy, Database } from 'lucide-react';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Notifications & Requests
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);

  // New Chat/Friend Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newChatTarget, setNewChatTarget] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');

  // Fetch Data Functions
  const fetchConversations = async () => {
      if(!user) return;
      const convs = await getConversationsAPI(user.id);
      setConversations(convs);
  };

  const fetchRequests = async () => {
      if(!user) return;
      const reqs = await getIncomingFriendRequestsAPI(user.id);
      setFriendRequests(reqs);
      
      // Update badge count
      const pendingCount = reqs.filter(r => r.status === 'pending').length;
      setUnreadNotifsCount(pendingCount);
  };

  // Initial Load + Realtime Subscriptions
  useEffect(() => {
    if (!user) return;

    const init = async () => {
        setLoading(true);
        await Promise.all([fetchConversations(), fetchRequests()]);
        setLoading(false);
    };
    init();

    // Subscribe to NEW Friend Requests (Realtime)
    const unsubscribeRequests = subscribeToFriendRequests(user.id, () => {
        fetchRequests();
        // Note: On pourrait aussi recharger les conversations si une requête a été acceptée ailleurs
    });

    return () => {
        unsubscribeRequests();
    };
  }, [user]);

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setModalLoading(true);
    setModalError('');
    setModalSuccess('');

    try {
        await sendFriendRequestAPI(user.id, newChatTarget);
        setModalSuccess(`Demande envoyée à ${newChatTarget} !`);
        setNewChatTarget('');
        
        setTimeout(() => {
            setIsModalOpen(false);
            setModalSuccess('');
        }, 2000);
    } catch (err: any) {
        setModalError(err.message || "Impossible d'envoyer la demande");
    } finally {
        setModalLoading(false);
    }
  };

  const handleRespondToRequest = async (requestId: string, status: 'accepted' | 'rejected') => {
      try {
        // Optimistic UI update
        setFriendRequests(prev => prev.filter(r => r.id !== requestId));
        setUnreadNotifsCount(prev => Math.max(0, prev - 1));

        const newConv = await respondToFriendRequestAPI(requestId, status);
        
        if (status === 'accepted' && newConv) {
            await fetchConversations(); 
            setActiveConversationId(newConv.id);
            setShowNotifications(false);
        }
      } catch (err) {
          console.error("Erreur lors de la réponse à la demande", err);
          fetchRequests(); // Revert
      }
  };

  const handleDeleteConversation = async (id: string) => {
      const success = await deleteConversationAPI(id);
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
    <div className="flex h-screen w-full bg-gray-100 overflow-hidden relative font-sans">
      
      {/* Modal: Ajouter un ami */}
      {isModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200 border border-gray-100">
                <button 
                    onClick={() => setIsModalOpen(false)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={24} />
                </button>
                
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                        <UserPlus size={24} />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800">Ajouter un contact</h2>
                </div>
                
                <p className="text-sm text-gray-500 mb-6">
                   Entrez l'identifiant unique <b>Nom#1234</b>.
                </p>
                
                <form onSubmit={handleSendFriendRequest}>
                    <Input 
                        label="Identifiant Talkio"
                        placeholder="ex: Alice#1234"
                        value={newChatTarget}
                        onChange={(e) => setNewChatTarget(e.target.value)}
                        autoFocus
                        className="text-lg"
                    />
                    
                    {modalError && (
                        <div className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100 flex items-center gap-2">
                             <XIcon size={16} /> {modalError}
                        </div>
                    )}

                    {modalSuccess && (
                        <div className="mb-4 text-sm text-green-600 bg-green-50 p-3 rounded border border-green-100 flex items-center gap-2">
                            <Check size={16} /> {modalSuccess}
                        </div>
                    )}
                    
                    <div className="flex justify-end gap-3 mt-6">
                        <Button type="button" variant="secondary" className="w-auto" onClick={() => setIsModalOpen(false)} disabled={modalLoading}>
                            Annuler
                        </Button>
                        <Button type="submit" className="w-auto bg-orange-600 hover:bg-orange-700 focus:ring-orange-500" isLoading={modalLoading} disabled={!newChatTarget.trim() || !!modalSuccess}>
                            Envoyer demande
                        </Button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`${activeConversationId ? 'hidden md:flex' : 'flex'} w-full md:w-[350px] lg:w-[400px] bg-white border-r border-gray-200 flex-col z-20 shadow-xl shadow-gray-200/50`}>
        {/* Sidebar Header */}
        <div className="h-16 bg-white flex items-center justify-between px-4 border-b border-gray-100 shrink-0 relative z-30">
           <div className="flex items-center gap-3 overflow-hidden group cursor-pointer" onClick={copyToClipboard} title="Cliquez pour copier votre ID">
             <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-100 to-orange-200 border border-orange-200 flex items-center justify-center text-orange-700 font-bold flex-shrink-0 shadow-sm">
               {user?.username.charAt(0).toUpperCase()}
             </div>
             <div className="flex flex-col overflow-hidden">
                 <span className="font-semibold text-gray-800 truncate group-hover:text-orange-600 transition-colors">{user?.username}</span>
                 <span className="text-xs text-orange-600 font-bold bg-orange-50 px-1.5 rounded-sm w-fit flex items-center gap-1">
                    #{user?.tag} <Copy size={8} />
                 </span>
             </div>
           </div>
           <div className="flex gap-1 text-gray-500 flex-shrink-0">
              
              {/* Notification Bell */}
              <div className="relative">
                  <button 
                    onClick={() => setShowNotifications(!showNotifications)}
                    className={`p-2 rounded-full transition-colors ${showNotifications ? 'bg-orange-100 text-orange-600' : 'hover:bg-gray-100 text-gray-600'}`}
                    title="Notifications"
                  >
                    <Bell size={22} />
                    {unreadNotifsCount > 0 && (
                        <span className="absolute top-1 right-1 h-4 w-4 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-[9px] text-white font-bold animate-pulse shadow-sm">
                            {unreadNotifsCount}
                        </span>
                    )}
                  </button>

                  {/* Dropdown Notifications */}
                  {showNotifications && (
                      <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden ring-1 ring-black ring-opacity-5">
                          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                             <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Demandes d'amis</h3>
                          </div>
                          
                          {friendRequests.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm flex flex-col items-center gap-2">
                                  <Bell size={24} className="opacity-20" />
                                  Aucune nouvelle demande
                              </div>
                          ) : (
                              <div className="max-h-64 overflow-y-auto no-scrollbar">
                                  {friendRequests.map(req => (
                                      <div key={req.id} className="flex items-center justify-between p-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors">
                                          <div className="flex items-center gap-3">
                                              <div className="h-9 w-9 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-sm font-bold">
                                                  {req.sender?.username.charAt(0).toUpperCase()}
                                              </div>
                                              <div className="flex flex-col">
                                                  <span className="font-semibold text-sm text-gray-800">{req.sender?.username}</span>
                                                  <span className="text-xs text-gray-400">veut être votre ami</span>
                                              </div>
                                          </div>
                                          <div className="flex gap-2">
                                              <button 
                                                onClick={() => handleRespondToRequest(req.id, 'rejected')}
                                                className="p-1.5 bg-gray-100 text-gray-500 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors"
                                                title="Refuser"
                                              >
                                                  <XIcon size={16} />
                                              </button>
                                              <button 
                                                onClick={() => handleRespondToRequest(req.id, 'accepted')}
                                                className="p-1.5 bg-green-100 text-green-600 rounded-full hover:bg-green-200 transition-colors shadow-sm"
                                                title="Accepter"
                                              >
                                                  <Check size={16} />
                                              </button>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  )}
              </div>

              <button 
                onClick={() => setIsModalOpen(true)}
                className="hover:bg-orange-50 p-2 rounded-full transition-colors text-gray-600 hover:text-orange-600" 
                title="Ajouter un ami"
              >
                <UserPlus size={22} />
              </button>
              <button onClick={logout} className="hover:bg-red-50 p-2 rounded-full transition-colors text-gray-600 hover:text-red-500" title="Se déconnecter">
                <LogOut size={22} />
              </button>
           </div>
        </div>

        {/* Search */}
        <div className="p-3 bg-white">
            <input type="text" placeholder="Rechercher une discussion..." className="w-full bg-gray-100 text-sm rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all border border-transparent focus:bg-white focus:border-orange-200 placeholder-gray-400" />
        </div>

        {/* List */}
        {loading ? (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            </div>
        ) : (
            <ConversationList 
                conversations={conversations} 
                activeId={activeConversationId} 
                onSelect={setActiveConversationId}
                onDelete={handleDeleteConversation}
                currentUser={user!}
            />
        )}
      </div>

      {/* Main Chat Area */}
      <div className={`${!activeConversationId ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-[#f3f4f6] h-full relative`}>
        {activeConversation ? (
            <ChatWindow 
                conversation={activeConversation} 
                currentUser={user!} 
                onBack={() => setActiveConversationId(null)}
            />
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-gray-500 p-6 text-center relative overflow-hidden select-none">
                
                <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-8 shadow-xl shadow-orange-100 relative z-10 border border-orange-50 animate-in zoom-in duration-500">
                    <Database className="text-orange-600" size={64} />
                </div>
                <h1 className="text-4xl font-bold text-gray-800 mb-4 relative z-10 tracking-tight">Talkio <span className="text-orange-600">Cloud</span></h1>
                <p className="text-base max-w-md text-center mb-8 text-gray-600 leading-relaxed relative z-10">
                    Connecté à Supabase (PostgreSQL). <br/>
                    Données synchronisées en temps réel via le cloud.
                </p>
                
                <div 
                    className="relative z-10 bg-white px-6 py-3 rounded-full shadow-md border border-gray-200 flex items-center gap-3 mb-8 group cursor-pointer hover:border-orange-300 transition-colors transform hover:scale-105 active:scale-95 duration-200" 
                    onClick={copyToClipboard}
                >
                     <span className="font-mono text-lg font-bold text-gray-800 tracking-wide">{user?.username}<span className="text-orange-600">#{user?.tag}</span></span>
                     <Copy size={16} className="text-gray-400 group-hover:text-orange-600" />
                </div>

                <Button variant="primary" className="w-auto px-8 relative z-10 bg-orange-600 hover:bg-orange-700" onClick={() => setIsModalOpen(true)}>
                    <UserPlus size={18} className="mr-2 inline" />
                    Ajouter un ami
                </Button>
                
                <div className="mt-12 text-xs text-gray-400 flex items-center gap-2 justify-center relative z-10">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Online & Secure
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  );
};

const Main = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
      return <div className="h-screen w-screen flex items-center justify-center bg-gray-100 text-orange-600">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
  }

  return user ? <Dashboard /> : <AuthScreen />;
}

export default App;