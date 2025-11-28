import React, { useState, useRef, useEffect } from 'react';
import { Message, Reaction } from '../../types';
import { Check, CheckCheck, Pencil, Trash2, Reply, AlertTriangle, Loader2, Image as ImageIcon, SmilePlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onReply?: (msg: Message) => void;
  onReact?: (msg: Message, emoji: string) => void;
}

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥'];

const renderContent = (text: string) => {
    if (!text) return null;
    
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

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn, onEdit, onDelete, onReply, onReact }) => {
  const { user } = useAuth();
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.updated_at && !isDeleted;
  const readCount = message.read_count || 0;
  const isReadByOthers = readCount > 0;

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [translateX, setTranslateX] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const safeContent = message.content || "";
  const attachmentUrl = message.attachment_url || message.image_url;
  const isLegacyBase64 = safeContent.startsWith('data:image');
  const isImage = !!attachmentUrl || isLegacyBase64 || message.message_type === 'image';

  const reactionCounts: { [emoji: string]: { count: number, hasReacted: boolean } } = {};
  if (message.reactions) {
      message.reactions.forEach(r => {
          if (!reactionCounts[r.emoji]) {
              reactionCounts[r.emoji] = { count: 0, hasReacted: false };
          }
          reactionCounts[r.emoji].count += 1;
          if (r.user_id === user?.id) {
              reactionCounts[r.emoji].hasReacted = true;
          }
      });
  }

  return (
    <motion.div 
        layout
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`flex w-full mb-3 ${isOwn ? 'justify-end' : 'justify-start'} group relative`}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
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
        {onReply && !isDeleted && (
             <button onClick={() => onReply(message)} className={`opacity-0 group-hover:opacity-100 transition-all p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-400 ${isOwn ? 'order-first' : 'order-last'}`}>
                <Reply size={14} />
             </button>
        )}
        
        {isOwn && !isDeleted && !isImage && (
            <div className="opacity-0 group-hover:opacity-100 transition-all flex flex-col gap-1 mb-2 absolute top-0 -left-8">
                {onEdit && <button onClick={() => onEdit(message)} className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-white text-gray-500 rounded-full shadow-sm"><Pencil size={10} /></button>}
                {onDelete && <button onClick={() => onDelete(message)} className="p-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-white text-red-500 rounded-full shadow-sm"><Trash2 size={10} /></button>}
            </div>
        )}
        
        {isOwn && !isDeleted && isImage && (
             <div className="opacity-0 group-hover:opacity-100 transition-all flex flex-col gap-1 mb-2 absolute top-0 -left-8">
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
                  <div className="truncate opacity-80">
                    {(message.reply.content || "").startsWith('data:image') || message.reply.attachment_url ? '📷 Photo' : (message.reply.content || "")}
                  </div>
              </div>
          )}

          {!isOwn && !isDeleted && (
            <div className="text-[10px] font-bold text-brand-600 dark:text-brand-400 mb-1 uppercase tracking-wide">
              {message.sender_username}
            </div>
          )}
          
          <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
              {isDeleted ? (
                  <span className="flex items-center gap-1.5 text-sm opacity-80"><Trash2 size={12}/> Message supprimé</span>
              ) : (
                  <>
                      {isImage && (
                          <div className={`my-1 mb-2 relative w-full bg-gray-100 dark:bg-gray-800/50 rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]`}>
                             {!imgLoaded && !imgError && (
                                <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-100/50 dark:bg-gray-800/50 backdrop-blur-[2px]">
                                    <Loader2 className="animate-spin text-brand-500" size={32} />
                                </div>
                             )}
                             {imgError ? (
                                <div className="flex flex-col items-center justify-center text-red-500 gap-2 p-4 w-full h-full min-h-[200px] bg-red-50 dark:bg-red-900/10">
                                    <AlertTriangle size={24} />
                                    <span className="text-xs font-medium">Image non disponible</span>
                                </div>
                             ) : (
                                attachmentUrl ? (
                                    <img 
                                        src={attachmentUrl} 
                                        alt="Image envoyée" 
                                        className="relative z-10 w-full h-auto max-h-[400px] object-cover rounded-lg cursor-pointer min-h-[200px] block"
                                        onClick={() => window.open(attachmentUrl, '_blank')}
                                        onLoad={() => setImgLoaded(true)}
                                        onError={() => { setImgError(true); setImgLoaded(true); }}
                                    />
                                ) : (
                                    isLegacyBase64 ? (
                                        <img src={safeContent} alt="legacy" className="rounded-lg max-w-full" onLoad={() => setImgLoaded(true)} />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center text-gray-400 gap-2 p-4 w-full min-h-[200px]">
                                            <ImageIcon size={32} className="opacity-50" />
                                            <span className="text-xs">Chargement de l'image...</span>
                                        </div>
                                    )
                                )
                             )}
                          </div>
                      )}
                      
                      {!isLegacyBase64 && renderContent(safeContent)}
                  </>
              )}
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

          {!isDeleted && (
            <div className="flex flex-wrap gap-1 mt-2 -mb-5 relative z-20">
              {Object.entries(reactionCounts).map(([emoji, { count, hasReacted }]) => (
                <button
                  key={emoji}
                  onClick={(e) => { e.stopPropagation(); onReact?.(message, emoji); }}
                  className={`
                    px-1.5 py-0.5 rounded-full text-xs shadow-sm flex items-center gap-1 transition-transform hover:scale-105 border
                    ${hasReacted 
                        ? 'bg-brand-100 border-brand-200 text-brand-800 dark:bg-brand-900/50 dark:border-brand-800 dark:text-brand-100' 
                        : 'bg-white border-gray-200 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'}
                  `}
                >
                  <span>{emoji}</span>
                  <span className="font-semibold text-[10px]">{count}</span>
                </button>
              ))}
              
              <div className="relative">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker); }}
                    className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 shadow-sm border border-gray-200 dark:border-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <SmilePlus size={12} />
                  </button>
                  
                  {showEmojiPicker && (
                    <div 
                        ref={pickerRef} 
                        className={`absolute bottom-full mb-2 p-2 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 flex flex-wrap gap-1 z-50 max-w-[200px] w-max ${isOwn ? 'right-0' : 'left-0'}`}
                    >
                        {COMMON_EMOJIS.map(emoji => (
                            <button
                                key={emoji}
                                onClick={(e) => { e.stopPropagation(); onReact?.(message, emoji); setShowEmojiPicker(false); }}
                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-lg transition-colors"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};