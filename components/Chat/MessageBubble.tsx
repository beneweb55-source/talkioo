import React, { useState, useRef } from 'react';
import { Message } from '../../types';
import { Check, CheckCheck, Pencil, Trash2, Reply } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onReply?: (msg: Message) => void;
}

// Helper to linkify URLs
const renderContent = (text: string) => {
    const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/g);
    return parts.map((part, i) => {
        if (part.match(/^(https?:\/\/|www\.)/)) {
            let href = part;
            if (!href.startsWith('http')) {
                href = 'http://' + href;
            }
            return (
                <a 
                    key={i} 
                    href={href} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-blue-500 underline hover:text-blue-600 break-all"
                    onClick={(e) => e.stopPropagation()}
                >
                    {part}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn, onEdit, onDelete, onReply }) => {
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.updated_at && !isDeleted;
  
  // Logic: 
  // 0 = Sent (read_count excludes sender now)
  // > 0 = Read by at least one other person
  const readCount = message.read_count || 0;
  const isReadByOthers = readCount > 0;

  // Swipe logic
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [translateX, setTranslateX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => {
      setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
      if (touchStart === null) return;
      const current = e.targetTouches[0].clientX;
      const diff = current - touchStart;
      
      // Only allow dragging to the right for reply
      if (diff > 0 && diff < 100) {
          setTranslateX(diff);
      }
  };

  const onTouchEnd = () => {
      if (translateX > 50 && onReply) {
          onReply(message);
      }
      setTranslateX(0);
      setTouchStart(null);
  };

  return (
    <div 
        className={`flex w-full mb-3 ${isOwn ? 'justify-end' : 'justify-start'} group relative`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
    >
      {/* Swipe Indicator (Visible during swipe) */}
      {translateX > 0 && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 bg-gray-100 p-2 rounded-full z-0" style={{ transform: `translateX(${translateX > 50 ? 10 : 0}px)` }}>
              <Reply size={20} />
          </div>
      )}

      <div 
        className="flex items-end gap-2 max-w-[85%] transition-transform duration-200 z-10"
        style={{ transform: `translateX(${translateX}px)` }}
      >
        {/* Reply Button (Desktop - Appears on Left for Own, Right for Other) */}
        {onReply && !isDeleted && (
             <button 
                onClick={() => onReply(message)}
                className={`opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 rounded-full shadow-sm mb-2 ${isOwn ? 'order-first' : 'order-last'}`}
                title="Répondre"
             >
                <Reply size={14} />
             </button>
        )}

        {/* Actions Menu (Edit/Delete) */}
        {isOwn && !isDeleted && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 mb-2">
                {onEdit && (
                    <button 
                        onClick={() => onEdit(message)} 
                        className="p-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 hover:text-blue-600 rounded-full shadow-sm transition-colors"
                        title="Modifier"
                    >
                        <Pencil size={12} />
                    </button>
                )}
                {onDelete && (
                    <button 
                        onClick={() => onDelete(message)} 
                        className="p-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 text-gray-500 dark:text-gray-300 hover:text-red-600 rounded-full shadow-sm transition-colors"
                        title="Supprimer"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        )}

        <div
          className={`relative px-4 py-2 shadow-sm transition-all flex flex-col ${
            isOwn 
              ? 'bg-[#d9fdd3] dark:bg-orange-700 text-gray-900 dark:text-white rounded-2xl rounded-tr-sm' 
              : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm'
          } ${isDeleted ? 'opacity-70 bg-gray-100 dark:bg-gray-800 italic text-gray-500 dark:text-gray-400' : ''}`}
        >
          
          {/* Replied Message Preview */}
          {message.reply && !isDeleted && (
              <div className={`mb-2 rounded-md p-2 border-l-4 text-xs cursor-pointer opacity-80 bg-black/5 dark:bg-white/10 ${isOwn ? 'border-green-600 dark:border-orange-400' : 'border-orange-500'}`}>
                  <div className={`font-bold mb-0.5 ${isOwn ? 'text-green-800 dark:text-orange-200' : 'text-orange-700 dark:text-orange-400'}`}>
                      {message.reply.sender}
                  </div>
                  <div className="truncate text-gray-600 dark:text-gray-300 line-clamp-1">
                      {message.reply.content}
                  </div>
              </div>
          )}

          {!isOwn && !isDeleted && (
            <div className="text-xs font-bold text-green-600 dark:text-orange-400 mb-1 opacity-90">
              {message.sender_username}
            </div>
          )}
          
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words min-w-[80px]">
              {isDeleted ? (
                  <span className="flex items-center gap-1 text-sm">
                      🚫 <span className="text-xs">Ce message a été supprimé</span>
                  </span>
              ) : (
                  renderContent(message.content)
              )}
          </p>
          
          <div className={`flex items-center justify-end gap-1 mt-1 text-gray-400 dark:text-gray-300`}>
            {isEdited && (
                <span className="text-[10px] mr-1 italic">(modifié)</span>
            )}
            <span className="text-[10px]">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isOwn && !isDeleted && (
                isReadByOthers ? (
                    // Double check blue if read by others (>0)
                    <CheckCheck size={14} className="opacity-100 text-blue-500 dark:text-blue-400" />
                ) : (
                    // Single check gray if only I sent it (0)
                    <Check size={14} className="opacity-80 text-gray-400 dark:text-gray-300" />
                )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};