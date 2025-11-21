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
}

export const ConversationList: React.FC<ConversationListProps> = ({ 
  conversations, 
  activeId, 
  onSelect,
  onDelete,
  currentUser
}) => {
  
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar overscroll-contain">
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
        if(window.confirm("Supprimer cette conversation de votre liste ?\n(Elle réapparaîtra si vous recevez un nouveau message)")) {
            onDelete(conv.id);
        }
    };

    return (
        <div 
            onClick={() => onSelect(conv.id)}
            className={`
                px-4 py-4 cursor-pointer transition-colors flex items-center justify-between group border-b border-gray-50 last:border-0
                ${isActive ? 'bg-orange-50 border-r-4 border-r-orange-500' : 'hover:bg-gray-50 border-r-4 border-r-transparent active:bg-gray-100'}
            `}
        >
            <div className="flex items-center gap-4 overflow-hidden">
                <div className={`
                    h-12 w-12 rounded-full flex items-center justify-center text-lg font-semibold flex-shrink-0
                    ${isActive ? 'bg-orange-200 text-orange-800' : 'bg-gray-200 text-gray-600'}
                `}>
                    {conv.is_group ? <Users size={22} /> : name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col overflow-hidden gap-0.5">
                    <span className={`font-medium text-base truncate ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
                        {name}
                    </span>
                    <span className="text-sm text-gray-500 truncate max-w-[180px] md:max-w-[220px]">
                        {conv.last_message}
                    </span>
                </div>
            </div>
            
            <div className="flex flex-col items-end gap-2">
                <span className="text-[11px] text-gray-400">
                    {new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
                {/* Delete visible on group hover for desktop, but need visual indicator or swipe for mobile in V2. Keep simple for now */}
                <button onClick={handleDelete} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2 -m-2 rounded-full hover:bg-red-50">
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
};