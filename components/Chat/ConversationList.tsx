import React, { useEffect, useState } from 'react';
import { Conversation, User } from '../../types';
import { getOtherParticipant } from '../../services/supabaseService';
import { Users, User as UserIcon, Trash2 } from 'lucide-react';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  currentUser: User;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({ 
  conversations, 
  activeId, 
  onSelect,
  onDelete,
  currentUser
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
        />
      ))}
    </div>
  );
};

const ConversationItem = ({ conv, currentUser, isActive, onSelect, onDelete }: any) => {
    const [name, setName] = useState(conv.name || 'Chargement...');

    useEffect(() => {
        const fetchName = async () => {
            if (conv.is_group) {
                setName(conv.name);
            } else {
                const other = await getOtherParticipant(conv.id, currentUser.id);
                setName(other ? `${other.username}#${other.tag}` : 'Utilisateur Inconnu');
            }
        };
        fetchName();
    }, [conv, currentUser]);

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if(window.confirm("Voulez-vous vraiment supprimer cette conversation ?")) {
            onDelete(conv.id);
        }
    };

    return (
        <div 
            onClick={() => onSelect(conv.id)}
            className={`
                px-4 py-3 cursor-pointer transition-colors flex items-center justify-between group
                ${isActive ? 'bg-orange-50 border-r-4 border-orange-500' : 'hover:bg-gray-50 border-r-4 border-transparent'}
            `}
        >
            <div className="flex items-center gap-3 overflow-hidden">
                <div className={`
                    h-12 w-12 rounded-full flex items-center justify-center text-lg font-semibold flex-shrink-0
                    ${isActive ? 'bg-orange-200 text-orange-800' : 'bg-gray-200 text-gray-600'}
                `}>
                    {conv.is_group ? <Users size={20} /> : name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col overflow-hidden">
                    <span className={`font-medium text-sm truncate ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                        {name}
                    </span>
                    <span className="text-xs text-gray-500 truncate max-w-[180px]">
                        {conv.last_message}
                    </span>
                </div>
            </div>
            
            <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] text-gray-400">
                    {new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
                <button onClick={handleDelete} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
};