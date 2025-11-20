import React from 'react';
import { Conversation, User } from '../../types';
import { getOtherParticipant } from '../../services/mockBackend';
import { Users, User as UserIcon, Trash2 } from 'lucide-react';

interface ConversationListProps {
  conversations: Conversation[];
  activeId: number | null;
  currentUser: User;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({ 
  conversations, 
  activeId, 
  onSelect,
  onDelete,
  currentUser
}) => {
  
  const getConversationName = (conv: Conversation) => {
    if (conv.is_group) return conv.name;
    const other = getOtherParticipant(conv.id, currentUser.id);
    return other ? `${other.username}#${other.id}` : 'Utilisateur Inconnu';
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
      e.stopPropagation();
      if(window.confirm("Voulez-vous vraiment supprimer cette conversation ?")) {
          onDelete(id);
      }
  }

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar">
      {conversations.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">
              Aucune conversation. Cliquez sur le bouton + pour commencer.
          </div>
      )}
      {conversations.map((conv) => {
        const isActive = activeId === conv.id;
        const name = getConversationName(conv);
        
        return (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`w-full px-4 py-3 flex items-center cursor-pointer transition-all border-b border-gray-50 group ${
              isActive ? 'bg-orange-50' : 'hover:bg-gray-50 bg-white'
            }`}
          >
            <div className={`flex-shrink-0 h-12 w-12 rounded-full flex items-center justify-center text-white shadow-sm ${conv.is_group ? 'bg-indigo-500' : 'bg-orange-200 text-orange-600'}`}>
               {conv.is_group ? <Users size={20} /> : <UserIcon size={20} />}
            </div>
            
            <div className="ml-3 flex-1 min-w-0">
              <div className="flex justify-between items-center mb-1">
                <h3 className={`text-sm font-semibold truncate ${isActive ? 'text-orange-900' : 'text-gray-800'}`}>
                  {name}
                </h3>
                <span className="text-xs text-gray-400">
                  {conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <p className={`text-sm truncate max-w-[80%] ${isActive ? 'text-orange-700' : 'text-gray-500'}`}>
                    {conv.last_message}
                </p>
                <button 
                    onClick={(e) => handleDelete(e, conv.id)}
                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    title="Supprimer"
                >
                    <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};