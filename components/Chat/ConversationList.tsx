import React, { useEffect, useState } from 'react';
import { Conversation, User } from '../../types';
import { getOtherParticipant } from '../../services/api';
import { Users, User as UserIcon, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  currentUser: User;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onlineUsers: Set<string>;
}

export const ConversationList: React.FC<ConversationListProps> = ({ 
  conversations, 
  activeId, 
  onSelect,
  onDelete,
  currentUser,
  onlineUsers
}) => {
  
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-2 space-y-1">
      <AnimatePresence>
        {conversations.length === 0 && (
            <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="p-8 text-center"
            >
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                    <Users size={24} />
                </div>
                <p className="text-gray-500 text-sm font-medium">Aucune conversation</p>
                <p className="text-gray-400 text-xs mt-1">Démarrez un chat pour commencer</p>
            </motion.div>
        )}
        {conversations.map((conv, i) => (
            <motion.div
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
                    onDelete={onDelete} 
                    onlineUsers={onlineUsers}
                />
            </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const ConversationItem = ({ conv, currentUser, isActive, onSelect, onDelete, onlineUsers }: any) => {
    const [name, setName] = useState(conv.name || 'Chargement...');
    const [otherUserId, setOtherUserId] = useState<string | null>(null);

    useEffect(() => {
        const fetchName = async () => {
            if (conv.is_group) {
                setName(conv.name);
            } else {
                const other = await getOtherParticipant(conv.id, currentUser.id);
                if (other) {
                    setName(`${other.username}#${other.tag}`);
                    setOtherUserId(other.id);
                } else {
                    setName('Utilisateur Inconnu');
                }
            }
        };
        fetchName();
    }, [conv, currentUser]);

    const isOnline = otherUserId && onlineUsers.has(otherUserId);

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if(window.confirm("Supprimer cette conversation ?")) {
            onDelete(conv.id);
        }
    };

    return (
        <motion.div 
            onClick={() => onSelect(conv.id)}
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
                        h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold shadow-sm
                        ${isActive 
                            ? 'bg-white/20 text-white backdrop-blur-sm' 
                            : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 text-gray-600 dark:text-gray-300'}
                    `}>
                        {conv.is_group ? <Users size={20} /> : name.charAt(0).toUpperCase()}
                    </div>
                    {isOnline && !conv.is_group && (
                        <span className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 ${isActive ? 'border-brand-500' : 'border-white dark:border-gray-900'}`}></span>
                    )}
                </div>
                
                <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                        <span className={`font-semibold text-sm truncate ${isActive ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                            {name}
                        </span>
                        <span className={`text-[10px] ml-2 flex-shrink-0 ${isActive ? 'text-brand-100' : 'text-gray-400'}`}>
                             {new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                    </div>
                    <div className="flex justify-between items-center mt-0.5">
                        <span className={`text-xs truncate max-w-[85%] ${isActive ? 'text-brand-100' : 'text-gray-500 dark:text-gray-400'}`}>
                            {conv.last_message}
                        </span>
                    </div>
                </div>
            </div>

            {!isActive && (
                <button 
                    onClick={handleDelete} 
                    className="absolute right-2 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full opacity-0 group-hover:opacity-100 transition-all z-20"
                >
                    <Trash2 size={16} />
                </button>
            )}
        </motion.div>
    );
};