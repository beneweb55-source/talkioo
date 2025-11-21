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
  subscribeToFriendRequests,
  subscribeToConversationsList
} from './services/api';
import { MessageCircleCode, UserPlus, Bell, Check, X as XIcon, LogOut, X, Copy, RefreshCw } from 'lucide-react';
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
  const [refreshingNotifs, setRefreshingNotifs] = useState(false);

  // New Chat/Friend Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newChatTarget, setNewChatTarget] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');

  // Fetch Data Functions
  const fetchConversations = async () => {
      if(!user) return;
      try {
          const convs = await getConversationsAPI(user.id);
          setConversations(convs);
      } catch (e) {
          console.error("Error fetching conversations (Ensure Server is Running)", e);
      }
  };

  const fetchRequests = async () => {
      if(!user) return;
      setRefreshingNotifs(true);
      try {
          const reqs = await getIncomingFriendRequestsAPI(user.id);
          setFriendRequests(reqs);
          
          // Update badge count
          const pendingCount = reqs.filter(r => r.status === 'pending').length;
          setUnreadNotifsCount(pendingCount);
      } catch (e) {
          console.error("Error fetching requests", e);
      } finally {
          setRefreshingNotifs(false);
      }
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
    });

    // Subscribe to Conversation List updates (New Message, New Friend Accept)
    const unsubscribeConvs = subscribeToConversationsList(() => {
        fetchConversations();
    });

    return () => {
        unsubscribeRequests();
        unsubscribeConvs();
    };
  }, [user]);

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setModalLoading(true);
    setModalError('');
    setModalSuccess('');

    try {
        const response = await sendFriendRequestAPI(user.id, newChatTarget);
        
        // Check for Mutual Add (conversationId present in response)
        if (response && response.conversationId) {
             setModalSuccess("Ami ajouté mutuellement !");
             await fetchConversations();
             setActiveConversationId(response.conversationId);
             setTimeout(() => {
                setIsModalOpen(false);
                setModalSuccess('');
                setNewChatTarget('');
            }, 1500);
        } else {
             setModalSuccess(`Demande envoyée à ${newChatTarget} !`);
             setNewChatTarget('');
             setTimeout(() => {
                setIsModalOpen(false);
                setModalSuccess('');
            }, 2000);
        }
    } catch (err: any) {
        // Detection of the "Restored Chat" legacy case
        if (err.message && err.message.includes('rouverte')) {
            setModalSuccess(err.message); 
            setNewChatTarget('');
             setTimeout(() => {
                setIsModalOpen(false);
                setModalSuccess('');
            }, 2000);
        } else {
            setModalError(err.message || "Impossible d'envoyer la demande");
        }
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
            setActiveConversationId(newConv.id); // Note: ID might not be perfectly sync if backend doesn't return it in body
            setShowNotifications(false);
        }
      } catch (err) {
          console.error("Erreur lors de la réponse à la demande", err);
          fetchRequests(); // Revert
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
    // Utilisation de h-[100dvh] pour le mobile (gère la barre d'adresse)
    <div className="flex h-[100dvh] w-full bg-gray-100 overflow-hidden relative font-sans">
      
      {/* Modal: Ajouter un ami */}
      {isModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white rounded-xl shadow-2xl w-[90%] md:w-full max-w-md p-6 relative animate-in fade-in zoom-in duration-200 border border-gray-100">
                <button 
                    onClick={() => setIsModalOpen(false)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-2"
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
                      <div className="absolute top-full right-[-60px] md:right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden ring-1 ring-black ring-opacity-5">
                          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                             <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Demandes d'amis</h3>
                             <button onClick={fetchRequests} className={`text-gray-400 hover:text-orange-600 transition-colors ${refreshingNotifs ? 'animate-spin' : ''}`}>
                                 <RefreshCw size={14} />
                             </button>
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
                                                className="p-1.5 bg-orange-100 text-orange-600 rounded-full hover:bg-orange-200 transition-colors"
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

              {/* Add Friend Button */}
              <button onClick={() => setIsModalOpen(true)} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors" title="Nouveau chat">
                  <UserPlus size={22} />
              </button>
              
              {/* Logout */}
              <button onClick={logout} className="p-2 hover:bg-red-50 rounded-full text-gray-400 hover:text-red-600 transition-colors" title="Se déconnecter">
                  <LogOut size={22} />
              </button>
           </div>
        </div>

        {/* Search (Visual only for MVP) */}
        <div className="p-3 border-b border-gray-100 bg-gray-50/50">
             <input 
                type="text" 
                placeholder="Rechercher une discussion..." 
                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
             />
        </div>

        {/* List */}
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {loading ? (
                <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600"></div></div>
            ) : (
                <ConversationList 
                    conversations={conversations}
                    activeId={activeConversationId}
                    currentUser={user!}
                    onSelect={setActiveConversationId}
                    onDelete={handleDeleteConversation}
                />
            )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 relative bg-gray-200 flex flex-col ${!activeConversationId ? 'hidden md:flex' : 'flex'}`}>
          {activeConversation && user ? (
              <ChatWindow 
                  conversation={activeConversation} 
                  currentUser={user} 
                  onBack={() => setActiveConversationId(null)}
              />
          ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 p-6 bg-[#f0f2f5]">
                  <div className="bg-white p-6 rounded-full shadow-sm mb-6">
                      <MessageCircleCode size={64} className="text-orange-200" />
                  </div>
                  <h1 className="text-3xl font-light text-gray-600 mb-2">Talkio Web</h1>
                  <p className="text-sm max-w-md text-center text-gray-500">
                      Envoyez et recevez des messages en temps réel. <br/>
                      Sélectionnez une conversation pour commencer.
                  </p>
                  <div className="mt-8 h-1 w-24 bg-orange-200 rounded-full"></div>
              </div>
          )}
      </div>

    </div>
  );
};

const App = () => {
  return (
    <AuthProvider>
      <AuthWrapper />
    </AuthProvider>
  );
};

const AuthWrapper = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="h-[100dvh] w-screen flex items-center justify-center bg-gray-50 text-orange-600">Chargement...</div>;
  }

  return user ? <Dashboard /> : <AuthScreen />;
};

export default App;