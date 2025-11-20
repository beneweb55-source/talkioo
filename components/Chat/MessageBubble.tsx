import React from 'react';
import { Message } from '../../types';
import { CheckCheck, Pencil, Trash2 } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn, onEdit, onDelete }) => {
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.updated_at && !isDeleted;

  return (
    <div className={`flex w-full mb-3 ${isOwn ? 'justify-end' : 'justify-start'} group`}>
      <div className="flex items-end gap-2 max-w-[85%]">
        {/* Action Buttons (Only for own valid messages) */}
        {isOwn && !isDeleted && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 mb-2">
                {onEdit && (
                    <button 
                        onClick={() => onEdit(message)} 
                        className="p-1.5 bg-gray-100 hover:bg-white text-gray-500 hover:text-blue-600 rounded-full shadow-sm transition-colors"
                        title="Modifier"
                    >
                        <Pencil size={12} />
                    </button>
                )}
                {onDelete && (
                    <button 
                        onClick={() => onDelete(message)} 
                        className="p-1.5 bg-gray-100 hover:bg-white text-gray-500 hover:text-red-600 rounded-full shadow-sm transition-colors"
                        title="Supprimer"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        )}

        <div
          className={`relative px-4 py-2 shadow-sm transition-all ${
            isOwn 
              ? 'bg-[#d9fdd3] text-gray-900 rounded-2xl rounded-tr-sm' 
              : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm'
          } ${isDeleted ? 'opacity-70 bg-gray-100 italic text-gray-500' : ''}`}
        >
          {!isOwn && !isDeleted && (
            <div className="text-xs font-bold text-green-600 mb-1 opacity-90">
              {message.sender_username}
            </div>
          )}
          
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words min-w-[80px]">
              {isDeleted ? (
                  <span className="flex items-center gap-1 text-sm">
                      🚫 <span className="text-xs">Ce message a été supprimé</span>
                  </span>
              ) : (
                  message.content
              )}
          </p>
          
          <div className={`flex items-center justify-end gap-1 mt-1 text-gray-400`}>
            {isEdited && (
                <span className="text-[10px] mr-1 italic">(modifié)</span>
            )}
            <span className="text-[10px]">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isOwn && !isDeleted && <CheckCheck size={14} className="opacity-80 text-blue-400" />}
          </div>
        </div>
      </div>
    </div>
  );
};