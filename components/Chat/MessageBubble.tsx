import React, { useState } from 'react';
import { Message } from '../../types';
import { Check, CheckCheck, Pencil, Trash2, Reply } from 'lucide-react';
import { motion } from 'framer-motion';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onReply?: (msg: Message) => void;
}

const renderContent = (text: string) => {
    const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/g);
    return parts.map((part, i) => {
        if (part.match(/^(https?:\/\/|www\.)/)) {
            let href = part;
            if (!href.startsWith('http')) href = 'http://' + href;
            return (
                <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="underline opacity-90 hover:opacity-100 break-all" onClick={(e) => e.stopPropagation()}>
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
  const readCount = message.read_count || 0;
  const isReadByOthers = readCount > 0;

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [translateX, setTranslateX] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => setTouchStart(e.targetTouches[0].clientX);
  const onTouchMove = (e: React.TouchEvent) => {
      if (touchStart === null) return;
      const diff = e.targetTouches[0].clientX - touchStart;
      if (diff > 0 && diff < 80) setTranslateX(diff);
  };
  const onTouchEnd = () => {
      if (translateX > 40 && onReply) onReply(message);
      setTranslateX(0); setTouchStart(null);
  };

  return (
    <motion.div 
        layout
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`flex w-full mb-3 ${isOwn ? 'justify-end' : 'justify-start'} group relative`}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      {/* Swipe Indicator */}
      <motion.div 
        className="absolute left-0 top-1/2 -translate-y-1/2 text-brand-500 bg-brand-50 dark:bg-brand-900/30 p-2 rounded-full z-0 opacity-0" 
        animate={{ x: translateX > 40 ? 10 : 0, opacity: translateX > 10 ? 1 : 0 }}
      >
          <Reply size={16} />
      </motion.div>

      <div 
        className="flex items-end gap-2 max-w-[85%] sm:max-w-[70%] transition-transform duration-200 z-10"
        style={{ transform: `translateX(${translateX}px)` }}
      >
        {/* PC Reply Button */}
        {onReply && !isDeleted && (
             <button onClick={() => onReply(message)} className={`opacity-0 group-hover:opacity-100 transition-all p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-400 ${isOwn ? 'order-first' : 'order-last'}`}>
                <Reply size={14} />
             </button>
        )}

        {/* Action Menu */}
        {isOwn && !isDeleted && (
            <div className="opacity-0 group-hover:opacity-100 transition-all flex flex-col gap-1 mb-2 absolute top-0 -left-8">
                {onEdit && <button onClick={() => onEdit(message)} className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-white text-gray-500 rounded-full shadow-sm"><Pencil size={10} /></button>}
                {onDelete && <button onClick={() => onDelete(message)} className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-white text-red-500 rounded-full shadow-sm"><Trash2 size={10} /></button>}
            </div>
        )}

        <div className={`relative px-4 py-2.5 shadow-sm flex flex-col ${
            isOwn 
              ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-2xl rounded-tr-sm' 
              : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm border border-gray-100 dark:border-gray-700'
          } ${isDeleted ? 'opacity-80 italic' : ''}`}
        >
          {message.reply && !isDeleted && (
              <div className={`mb-2 rounded-lg p-2 text-xs border-l-2 bg-black/10 dark:bg-white/5 ${isOwn ? 'border-white/50 text-white/90' : 'border-brand-500 text-gray-600 dark:text-gray-300'}`}>
                  <div className="font-bold opacity-90 mb-0.5">{message.reply.sender}</div>
                  <div className="truncate opacity-80">{message.reply.content}</div>
              </div>
          )}

          {!isOwn && !isDeleted && (
            <div className="text-[10px] font-bold text-brand-600 dark:text-brand-400 mb-1 uppercase tracking-wide">
              {message.sender_username}
            </div>
          )}
          
          <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
              {isDeleted ? <span className="flex items-center gap-1.5 text-sm opacity-80"><Trash2 size={12}/> Message supprimé</span> : renderContent(message.content)}
          </div>
          
          <div className={`flex items-center justify-end gap-1 mt-1 ${isOwn ? 'text-brand-100' : 'text-gray-400'}`}>
            {isEdited && <span className="text-[10px] opacity-80">modifié</span>}
            <span className="text-[10px] opacity-80">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isOwn && !isDeleted && (
                isReadByOthers 
                    ? <CheckCheck size={14} className="text-white" /> 
                    : <Check size={14} className="text-white/60" />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};