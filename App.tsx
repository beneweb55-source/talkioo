import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/Auth/AuthScreen';
import { ConversationList } from './components/Chat/ConversationList';
import { ChatWindow } from './components/Chat/ChatWindow';
import { Conversation } from './types';
import { getConversationsAPI, createConversationAPI, deleteConversationAPI } from './services/mockBackend';
import { MessageSquarePlus, LogOut, X, MessageCircleCode } from 'lucide-react';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  
  // New Chat Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newChatTarget, setNewChatTarget] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  const fetchConvs = async () => {
    if (!user) return;
    const data = await getConversationsAPI(user.id);
    setConversations(data);
    setLoading(false);
  };

  // Poll for conversation list updates
  useEffect(() => {
    fetchConvs();
    const interval = setInterval(fetchConvs, 4000); 
    return () => clearInterval(interval);
  }, [user]);

  const handleCreateChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setModalLoading(true);
    setModalError('');

    try {
        const newConv = await createConversationAPI(user.id, newChatTarget);
        await fetchConvs();
        setActiveConversationId(newConv.id);
        setIsModalOpen(false);
        setNewChatTarget('');
    } catch (err: any) {
        setModalError(err.message || "Impossible de créer la discussion");
    } finally {
        setModalLoading(false);
    }
  };

  const handleDeleteConversation = async (id: number) => {
      const success = await deleteConversationAPI(id);
      if (success) {
          if (activeConversationId === id) setActiveConversationId(null);
          fetchConvs();
      }
  };

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <div className="flex h-screen w-full bg-gray-100 overflow-hidden relative">
      
      {/* New Chat Modal */}
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
                        <MessageSquarePlus size={24} />
                    </div>
                    <h2 className="text-xl font-bold text-gray-800">Nouvelle Discussion</h2>
                </div>
                
                <p className="text-sm text-gray-500 mb-6">
                    Entrez l'identifiant unique de votre ami pour démarrer une conversation instantanée.
                </p>
                
                <form onSubmit={handleCreateChat}>
                    <Input 
                        label="Identifiant Talkio (Nom#ID)"
                        placeholder="ex: alice_dev#1"
                        value={newChatTarget}
                        onChange={(e) => setNewChatTarget(e.target.value)}
                        autoFocus
                    />
                    
                    {modalError && (
                        <div className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">
                            {modalError}
                        </div>
                    )}
                    
                    <div className="flex justify-end gap-3 mt-6">
                        <Button type="button" variant="secondary" className="w-auto" onClick={() => setIsModalOpen(false)} disabled={modalLoading}>
                            Annuler
                        </Button>
                        <Button type="submit" className="w-auto" isLoading={modalLoading} disabled={!newChatTarget.trim()}>
                            Commencer
                        </Button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* Sidebar */}
      <div className={`${activeConversationId ? 'hidden md:flex' : 'flex'} w-full md:w-[350px] lg:w-[400px] bg-white border-r border-gray-200 flex-col z-20 shadow-xl shadow-gray-200/50`}>
        {/* Sidebar Header */}
        <div className="h-16 bg-white flex items-center justify-between px-4 border-b border-gray-100">
           <div className="flex items-center gap-3 overflow-hidden">
             <div className="h-10 w-10 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600 font-bold flex-shrink-0 shadow-sm">
               {user?.username.charAt(0).toUpperCase()}
             </div>
             <div className="flex flex-col overflow-hidden">
                 <span className="font-semibold text-gray-800 truncate">{user?.username}</span>
                 <span className="text-xs text-orange-500 font-medium">#{user?.id}</span>
             </div>
           </div>
           <div className="flex gap-2 text-gray-500 flex-shrink-0">
              <button 
                onClick={() => setIsModalOpen(true)}
                className="hover:bg-orange-50 p-2 rounded-full transition-colors text-gray-600 hover:text-orange-600" 
                title="Nouvelle discussion"
              >
                <MessageSquarePlus size={22} />
              </button>
              <button onClick={logout} className="hover:bg-red-50 p-2 rounded-full transition-colors text-gray-600 hover:text-red-500" title="Se déconnecter">
                <LogOut size={22} />
              </button>
           </div>
        </div>

        {/* Search */}
        <div className="p-3 bg-white">
            <input type="text" placeholder="Rechercher..." className="w-full bg-gray-100 text-sm rounded-full px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all border border-transparent focus:bg-white focus:border-orange-200 placeholder-gray-400" />
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
      <div className={`${!activeConversationId ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-[#f8f9fa] h-full relative`}>
        {activeConversation ? (
            <ChatWindow 
                conversation={activeConversation} 
                currentUser={user!} 
                onBack={() => setActiveConversationId(null)}
            />
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-gray-500 p-6 text-center relative overflow-hidden">
                <div className="absolute inset-0 opacity-5 bg-[radial-gradient(#f97316_1px,transparent_1px)] [background-size:16px_16px]"></div>
                
                <div className="w-32 h-32 bg-orange-100 rounded-full flex items-center justify-center mb-8 shadow-sm relative z-10">
                    <MessageCircleCode className="text-orange-500" size={64} />
                </div>
                <h1 className="text-4xl font-bold text-gray-800 mb-4 relative z-10">Talkio Web</h1>
                <p className="text-base max-w-md text-center mb-8 text-gray-600 leading-relaxed relative z-10">
                    Communiquez simplement. Sans interruption. <br/>
                    Partagez votre ID <span className="font-mono bg-gray-200 px-2 py-1 rounded text-gray-800 text-sm">{user?.username}#{user?.id}</span> pour que vos amis vous trouvent.
                </p>
                <Button className="w-auto px-8 relative z-10 shadow-lg shadow-orange-500/30" onClick={() => setIsModalOpen(true)}>
                    Démarrer une discussion
                </Button>
                <div className="mt-12 text-xs text-gray-400 flex items-center gap-2 justify-center relative z-10">
                    <span>🔒</span> Chiffré de bout en bout
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
  const { user } = useAuth();
  return user ? <Dashboard /> : <AuthScreen />;
}

export default App;