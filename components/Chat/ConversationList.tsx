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
    <div className="flex-1 overflow-y-auto no-scrollbar bg-white dark:bg-gray-900">
      {conversations.length === 0 && (
          <div className="p-10 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-2">
                  <Users className="text-gray-300" />
              </div>
              <p>Aucune conversation.</p>
              <p className="text-xs">Appuyez sur "Ami" ou "Groupe" pour commencer.</p>
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
                    setName(`${other.username}`);
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

    // Style adjustments for better mobile touch targets (min-height 64px)
    return (
        <div 
            onClick={() => onSelect(conv.id)}
            className={`
                px-4 py-4 cursor-pointer transition-colors flex items-center justify-between group border-b border-gray-50 dark:border-gray-800
                ${isActive 
                    ? 'bg-orange-50 dark:bg-orange-900/10' 
                    : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'}
            `}
        >
            <div className="flex items-center gap-4 overflow-hidden flex-1">
                <div className="relative flex-shrink-0">
                    <div className={`
                        h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold shadow-sm
                        ${isActive ? 'bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-100' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}
                    `}>
                        {conv.is_group ? <Users size={24} /> : name.charAt(0).toUpperCase()}
                    </div>
                    {isOnline && !conv.is_group && (
                        <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-white dark:border-gray-900 shadow-sm"></span>
                    )}
                </div>
                
                <div className="flex flex-col overflow-hidden flex-1 gap-0.5">
                    <div className="flex justify-between items-center">
                        <span className={`font-bold text-base truncate ${isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}>
                            {name}
                        </span>
                        <span className="text-[11px] text-gray-400 flex-shrink-0 ml-2">
                            {new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                         <span className={`text-sm truncate max-w-[85%] ${conv.last_message.includes('supprimé') ? 'italic text-gray-400' : 'text-gray-500 dark:text-gray-400'} ${isActive ? 'font-medium' : ''}`}>
                            {conv.last_message}
                        </span>
                        {/* Delete button always visible on mobile if swiped? Simplified to click for now, or hold */}
                        <button onClick={handleDelete} className="text-gray-300 hover:text-red-500 p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 -mr-2">
                             <Trash2 size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};