
import React, { useEffect, useState } from 'react';
import { Conversation, User } from '../../types';
import { getOtherParticipant, subscribeToUserProfileUpdates } from '../../services/api';
import { Users, User as UserIcon, Trash2, AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../ui/Button';

const MotionDiv = motion.div as any;

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  currentUser: User;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onlineUsers: Set<string>;
  searchTerm?: string;
}

export const ConversationList: React.FC<ConversationListProps> = ({ 
  conversations, 
  activeId, 
  onSelect,
  onDelete,
  currentUser,
  onlineUsers,
  searchTerm = ''
}) => {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const filtered = conversations.filter(c => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      if (c.name && c.name.toLowerCase().includes(term)) return true;
      if (c.last_message && c.last_message.toLowerCase().includes(term)) return true;
      return false;
  });

  const confirmDelete = () => {
      if (deleteId) {
          onDelete(deleteId);
          setDeleteId(null);
      }
  };

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-2 space-y-1 pb-20 md:pb-2 relative">
      <AnimatePresence>
        {filtered.length === 0 && (
            <MotionDiv 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="p-8 text-center"
            >
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                    <Users size={24} />
                </div>
                <p className="text-gray-500 text-sm font-medium">Aucune conversation trouvée</p>
            </MotionDiv>
        )}
        {filtered.map((conv, i) => (
            <MotionDiv
                key={conv.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
            >
                <ConversationItem 
                    conv={conv} 
                    currentUser={currentUser} 
                    isActive={activeId === conv.id} 
                    onSelect={onSelect} 
                    onRequestDelete={(id: string) => setDeleteId(id)} 
                    onlineUsers={onlineUsers}
                />
            </MotionDiv>
        ))}
      </AnimatePresence>

      {/* Modern Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteId && (
            <MotionDiv
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-white/60 dark:bg-gray-900/60 backdrop-blur-md px-4"
                onClick={() => setDeleteId(null)}
            >
                <MotionDiv
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 p-5"
                >
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center text-red-500 mb-3">
                            <Trash2 size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Supprimer la conversation ?</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            Cette action effacera l'historique de votre vue. C'est irréversible.
                        </p>
                        <div className="flex gap-3 w-full">
                            <button 
                                onClick={() => setDeleteId(null)}
                                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                                Annuler
                            </button>
                            <button 
                                onClick={confirmDelete}
                                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30 transition-colors"
                            >
                                Supprimer
                            </button>
                        </div>
                    </div>
                </MotionDiv>
            </MotionDiv>
        )}
      </AnimatePresence>
    </div>
  );
};

const ConversationItem = ({ conv, currentUser, isActive, onSelect, onRequestDelete, onlineUsers }: any) => {
    const [name, setName] = useState(conv.name || 'Chargement...');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [otherUserId, setOtherUserId] = useState<string | null>(null);

    useEffect(() => {
        const fetchName = async () => {
            if (conv.is_group) {
                setName(conv.name);
                setAvatarUrl(conv.avatar_url || null);
            } else {
                if (conv.name && conv.name.includes('#')) {
                    setName(conv.name);
                }
                if (conv.avatar_url) {
                    setAvatarUrl(conv.avatar_url);
                }
                
                const other = await getOtherParticipant(conv.id, currentUser.id);
                if (other) {
                    setName(`${other.username}#${other.tag}`);
                    setAvatarUrl(other.avatar_url || null);
                    setOtherUserId(other.id);
                } else {
                    if (!conv.name || !conv.name.includes('#')) setName('Utilisateur Inconnu');
                }
            }
        };
        fetchName();
    }, [conv, currentUser]);

    useEffect(() => {
        if (!otherUserId) return;
        const unsub = subscribeToUserProfileUpdates((updatedUser) => {
            if (updatedUser.id === otherUserId) {
                 setName(`${updatedUser.username}#${updatedUser.tag}`);
                 setAvatarUrl(updatedUser.avatar_url || null);
            }
        });
        return () => unsub();
    }, [otherUserId]);

    const isOnline = otherUserId && onlineUsers.has(otherUserId);

    // Mobile Long Press Logic
    const [touchTimeout, setTouchTimeout] = useState<any>(null);

    const handleTouchStart = () => {
        const timer = setTimeout(() => {
             if(navigator.vibrate) navigator.vibrate(50);
             onRequestDelete(conv.id);
        }, 800); 
        setTouchTimeout(timer);
    };

    const handleTouchEnd = () => {
        if (touchTimeout) {
            clearTimeout(touchTimeout);
            setTouchTimeout(null);
        }
    };

    return (
        <MotionDiv 
            onClick={() => onSelect(conv.id)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className={`
                px-3 py-3 cursor-pointer rounded-xl transition-all duration-200 flex items-center justify-between group relative overflow-hidden
                ${isActive 
                    ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' 
                    : 'hover:bg-white dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'}
            `}
        >
            <div className="flex items-center gap-3 overflow-hidden relative z-10 w-full">
                <div className="relative flex-shrink-0">
                    <div className={`
                        h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm overflow-hidden
                        ${isActive 
                            ? 'bg-white/20 text-white backdrop-blur-sm' 
                            : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 text-gray-600 dark:text-gray-300'}
                    `}>
                        {avatarUrl ? (
                            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
                        ) : (
                            conv.is_group ? <Users size={20} /> : name.charAt(0).toUpperCase()
                        )}
                    </div>
                    {isOnline && !conv.is_group && (
                        <span className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 ${isActive ? 'border-brand-500' : 'border-white dark:border-gray-900'}`}></span>
                    )}
                </div>
                
                <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                        <span className={`font-semibold text-sm truncate ${isActive ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                            {name}
                        </span>
                        
                        {/* Time & Delete Swap Container */}
                        <div className="relative ml-2 flex-shrink-0 min-w-[50px] text-right h-5">
                            <span className={`
                                text-[10px] absolute right-0 top-1/2 -translate-y-1/2 transition-all duration-300
                                ${isActive ? 'text-brand-100' : 'text-gray-400 group-hover:opacity-0 group-hover:translate-x-2'}
                            `}>
                                 {new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                            
                            {!isActive && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onRequestDelete(conv.id); }}
                                    className="
                                        absolute right-0 top-1/2 -translate-y-1/2 p-1.5 
                                        text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full 
                                        opacity-0 translate-x-2 scale-75 
                                        group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 
                                        transition-all duration-300
                                        hidden md:block
                                    "
                                    title="Supprimer"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex justify-between items-center mt-0.5">
                        <span className={`text-xs truncate max-w-[95%] ${isActive ? 'text-brand-100' : 'text-gray-500 dark:text-gray-400'}`}>
                            {conv.last_message}
                        </span>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};
