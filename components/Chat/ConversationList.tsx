import React, { useEffect, useState } from 'react';
import { Conversation, User } from '../../types';
import { getOtherParticipant } from '../../services/api';
import { Users, User as UserIcon, Trash2 } from 'lucide-react';

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
    <div className="flex-1 overflow-y-auto no-scrollbar">
      {conversations.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">
              Aucune conversation. Cliquez sur le bouton + pour commencer.
          </div>
      )}
      {conversations.map((conv) => (
        <ConversationItem 
            key={conv.id} 
            conv={conv} 
            currentUser={currentUser} 
            isActive={activeId === conv.id} 
            onSelect={onSelect} 
            onDelete={onDelete} 
            onlineUsers={onlineUsers}
        />
      ))}
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
        if(window.confirm("Supprimer cette conversation de votre liste ?\n(Elle réapparaîtra si vous recevez un nouveau message)")) {
            onDelete(conv.id);
        }
    };

    return (
        <div 
            onClick={() => onSelect(conv.id)}
            className={`
                px-4 py-3 cursor-pointer transition-colors flex items-center justify-between group border-b border-transparent dark:border-gray-800
                ${isActive 
                    ? 'bg-orange-50 dark:bg-orange-900/20 border-r-4 border-r-orange-500 dark:border-r-orange-500' 
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-r-4 border-r-transparent'}
            `}
        >
            <div className="flex items-center gap-3 overflow-hidden">
                <div className="relative flex-shrink-0">
                    <div className={`
                        h-12 w-12 rounded-full flex items-center justify-center text-lg font-semibold 
                        ${isActive ? 'bg-orange-200 text-orange-800 dark:bg-orange-700 dark:text-orange-100' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}
                    `}>
                        {conv.is_group ? <Users size={20} /> : name.charAt(0).toUpperCase()}
                    </div>
                    {isOnline && !conv.is_group && (
                        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-white dark:border-gray-900"></span>
                    )}
                </div>
                
                <div className="flex flex-col overflow-hidden">
                    <span className={`font-medium text-sm truncate ${isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                        {name}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-500 truncate max-w-[180px]">
                        {conv.last_message}
                    </span>
                </div>
            </div>
            
            <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] text-gray-400">
                    {new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
                <button onClick={handleDelete} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
};