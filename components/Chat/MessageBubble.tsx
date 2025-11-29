import React, { useState, useRef, useEffect } from 'react';
import { Message, Reaction } from '../../types';
import { Check, CheckCheck, Pencil, Trash2, Reply, AlertTriangle, Loader2, Image as ImageIcon, SmilePlus, Plus, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';

const MotionDiv = motion.div as any;

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onReply?: (msg: Message) => void;
  onReact?: (msg: Message, emoji: string) => void;
  highlightTerm?: string; // New prop for search
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🔥'];

// Utility to highlight text
const HighlightedText = ({ text, term }: { text: string, term: string }) => {
    if (!term || !text) return <>{text}</>;
    
    // Escape regex characters
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedTerm})`, 'gi'));
    
    return (
        <>
            {parts.map((part, i) => 
                part.toLowerCase() === term.toLowerCase() ? (
                    <span key={i} className="bg-yellow-300 text-black font-semibold rounded-sm shadow-sm px-0.5">{part}</span>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    );
};

const renderContent = (text: string, highlightTerm?: string) => {
    if (!text) return null;
    
    const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/g);
    return parts.map((part, i) => {
        if (part.match(/^(https?:\/\/|www\.)/)) {
            let href = part;
            if (!href.startsWith('http')) href = 'http://' + href;
            return (
                <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="underline opacity-90 hover:opacity-100 break-all" onClick={(e) => e.stopPropagation()}>
                    {highlightTerm ? <HighlightedText text={part} term={highlightTerm} /> : part}
                </a>
            );
        }
        return <span key={i}>{highlightTerm ? <HighlightedText text={part} term={highlightTerm} /> : part}</span>;
    });
};

const getJumboEmojiClass = (text: string) => {
    if (!text) return null;
    const cleanText = text.trim();
    // Regex pour vérifier si le texte ne contient QUE des émojis et des espaces
    const isOnlyEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(cleanText);
    
    if (isOnlyEmoji) {
        const count = [...cleanText].filter(c => c.trim() !== '').length;
        
        // --- LOGIQUE JUMBO / STICKER ---
        
        // 1 à 3 émojis : MÊME GRANDE TAILLE, PAS DE BULLE
        // On retourne la classe de taille. Le composant gérera la suppression du bg.
        if (count >= 1 && count <= 3) return 'text-6xl tracking-widest';
        
        // 4+ émojis : On retourne null pour que ça utilise le rendu de texte standard (avec bulle)
        return null;
    }
    return null;
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn, onEdit, onDelete, onReply, onReact, highlightTerm }) => {
  const { user } = useAuth();
  const isDeleted = !!message.deleted_at;
  const isEdited = !!message.updated_at && !isDeleted;
  const readCount = message.read_count || 0;
  const isReadByOthers = readCount > 0;

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [translateX, setTranslateX] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [clickedReactionEmoji, setClickedReactionEmoji] = useState<string | null>(null);
  
  const reactionMenuRef = useRef<HTMLDivElement>(null);
  const fullPickerRef = useRef<HTMLDivElement>(null);
  const reactionDetailsRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<any>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (reactionMenuRef.current && !reactionMenuRef.current.contains(event.target as Node)) {
        setShowReactionMenu(false);
      }
      if (fullPickerRef.current && !fullPickerRef.current.contains(event.target as Node)) {
        setShowFullPicker(false);
      }
      if (reactionDetailsRef.current && !reactionDetailsRef.current.contains(event.target as Node)) {
        setClickedReactionEmoji(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- GESTION TOUCH ---
  const onTouchStart = (e: React.TouchEvent) => {
      setTouchStart(e.targetTouches[0].clientX);
      
      longPressTimer.current = setTimeout(() => {
          setShowReactionMenu(true); 
          if (navigator.vibrate) navigator.vibrate(50);
          setTouchStart(null);
      }, 500);
  };

  const onTouchMove = (e: React.TouchEvent) => {
      if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
      if (touchStart === null) return;
      const diff = e.targetTouches[0].clientX - touchStart;
      if (diff > 0 && diff < 80) setTranslateX(diff);
  };

  const onTouchEnd = () => {
      if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
      if (translateX > 40 && onReply) {
          onReply(message);
          if (navigator.vibrate) navigator.vibrate(20);
      }
      setTranslateX(0); 
      setTouchStart(null);
  };

  const safeContent = message.content || "";
  const attachmentUrl = message.attachment_url || message.image_url;
  const isLegacyBase64 = safeContent.startsWith('data:image');
  const isImage = !!attachmentUrl || isLegacyBase64 || message.message_type === 'image';
  
  // Si jumboClass est défini, c'est un "Sticker" (1-3 emojis). Sinon c'est null.
  const jumboClass = !isImage && !isDeleted ? getJumboEmojiClass(safeContent) : null;

  const reactionData: { [emoji: string]: { count: number, hasReacted: boolean, users: string[] } } = {};
  if (message.reactions) {
      message.reactions.forEach(r => {
          if (!reactionData[r.emoji]) {
              reactionData[r.emoji] = { count: 0, hasReacted: false, users: [] };
          }
          reactionData[r.emoji].count += 1;
          
          let displayName = r.username;
          
          // Sécurité : Si le backend ne renvoie pas le nom mais que c'est nous
          if (!displayName && user && String(r.user_id) === String(user.id)) {
              displayName = user.username;
          }

          if (displayName) {
              reactionData[r.emoji].users.push(displayName);
          } else {
             // Fallback visuel
             reactionData[r.emoji].users.push("Inconnu");
          }
          
          if (String(r.user_id) === String(user?.id)) {
              reactionData[r.emoji].hasReacted = true;
          }
      });
  }

  const onFullEmojiClick = (emojiData: EmojiClickData) => {
      onReact?.(message, emojiData.emoji);
      setShowFullPicker(false);
      setShowReactionMenu(false);
  };

  return (
    <MotionDiv 
        id={`msg-${message.id}`} // ID for scroll target
        layout
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`flex w-full mb-3 ${isOwn ? 'justify-end' : 'justify-start'} group relative select-none md:select-text`}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ zIndex: showReactionMenu || showFullPicker || clickedReactionEmoji ? 50 : 10 }}
    >
      <MotionDiv 
        className="absolute left-0 top-1/2 -translate-y-1/2 text-brand-500 bg-brand-50 dark:bg-brand-900/30 p-2 rounded-full z-0 opacity-0" 
        animate={{ x: translateX > 40 ? 10 : 0, opacity: translateX > 10 ? 1 : 0 }}
      >
          <Reply size={16} />
      </MotionDiv>

      <div 
        className={`flex items-end gap-2 max-w-[85%] sm:max-w-[70%] transition-transform duration-200 z-10`}
        style={{ transform: `translateX(${translateX}px)` }}
      >
        <div className={`relative flex flex-col min-w-[5rem]
            ${jumboClass 
                ? 'bg-transparent shadow-none border-none p-1' // Pas de bulle pour les emojis seuls
                : isOwn 
                    ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-2xl rounded-tr-sm shadow-sm' 
                    : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm border border-gray-100 dark:border-gray-700 shadow-sm'
            } 
            ${isDeleted ? 'opacity-80 italic px-4 py-2.5' : (jumboClass ? '' : 'px-4 py-2.5')}`}
        >
          {/* Unified ToolBar: Reactions AND Actions (Edit/Delete) */}
          {!isDeleted && (
            <div 
                ref={reactionMenuRef}
                className={`
                    absolute -top-14 z-50 flex items-center gap-1 p-1.5 bg-white dark:bg-gray-900 rounded-full shadow-xl border border-gray-100 dark:border-gray-700
                    transition-all duration-200 transform origin-bottom whitespace-nowrap
                    ${showReactionMenu ? 'scale-100 opacity-100' : 'scale-90 opacity-0 invisible group-hover:visible group-hover:scale-100 group-hover:opacity-100'}
                    ${isOwn ? 'right-0' : 'left-0'}
                `}
            >
                {QUICK_REACTIONS.map(emoji => (
                    <button
                        key={emoji}
                        onClick={(e) => { e.stopPropagation(); onReact?.(message, emoji); setShowReactionMenu(false); }}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-lg transition-transform hover:scale-110"
                    >
                        {emoji}
                    </button>
                ))}
                
                <button
                    onClick={(e) => { e.stopPropagation(); setShowFullPicker(true); setShowReactionMenu(true); }}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 dark:text-gray-400 transition-transform hover:scale-110 hover:text-brand-500"
                >
                    <Plus size={16} />
                </button>

                <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700 mx-1"></div>

                {onReply && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onReply(message); setShowReactionMenu(false); }}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 dark:text-gray-400 hover:text-brand-500 transition-colors"
                        title="Répondre"
                    >
                        <Reply size={15} />
                    </button>
                )}

                {isOwn && !isImage && !jumboClass && onEdit && (
                     <button 
                        onClick={(e) => { e.stopPropagation(); onEdit(message); setShowReactionMenu(false); }}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 dark:text-gray-400 hover:text-blue-500 transition-colors"
                        title="Modifier"
                    >
                        <Pencil size={14} />
                    </button>
                )}

                {isOwn && onDelete && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onDelete(message); setShowReactionMenu(false); }}
                        className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors"
                        title="Supprimer"
                    >
                        <Trash2 size={14} />
                    </button>
                )}

                {showFullPicker && (
                    <div 
                        ref={fullPickerRef}
                        className={`absolute top-full mt-2 z-[60] shadow-2xl rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 ${isOwn ? 'right-0' : 'left-0'}`}
                        style={{ width: '300px' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <EmojiPicker 
                            theme={Theme.AUTO}
                            onEmojiClick={onFullEmojiClick}
                            searchPlaceHolder="Rechercher..."
                            width="100%"
                            height={350}
                            previewConfig={{ showPreview: false }}
                        />
                    </div>
                )}
            </div>
          )}

          {message.reply && !isDeleted && !jumboClass && (
              <div className={`mb-2 rounded-lg p-2 text-xs border-l-2 bg-black/10 dark:bg-white/5 ${isOwn ? 'border-white/50 text-white/90' : 'border-brand-500 text-gray-600 dark:text-gray-300'}`}>
                  <div className="font-bold opacity-90 mb-0.5">{message.reply.sender}</div>
                  <div className="truncate opacity-80">
                    {(message.reply.content || "").startsWith('data:image') || message.reply.attachment_url ? '📷 Photo' : (message.reply.content || "")}
                  </div>
              </div>
          )}

          {!isOwn && !isDeleted && !jumboClass && (
            <div className="text-[10px] font-bold text-brand-600 dark:text-brand-400 mb-1 uppercase tracking-wide">
              {message.sender_username}
            </div>
          )}
          
          <div className={`break-words whitespace-pre-wrap ${jumboClass ? jumboClass : 'text-[15px] leading-relaxed'}`}>
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
                      
                      {!isLegacyBase64 && renderContent(safeContent, highlightTerm)}
                  </>
              )}
          </div>
          
          {/* Timestamp Container - Couleur adaptée si Jumbo */}
          <div className={`
              flex items-center justify-end gap-1 mt-1 select-none flex-wrap w-full
              ${jumboClass 
                ? 'text-gray-500 dark:text-gray-400' 
                : (isOwn ? 'text-brand-100' : 'text-gray-400')
              } 
              ${jumboClass ? 'px-2 pb-1' : ''}
          `}>
            {isEdited && <span className="text-[10px] opacity-80">modifié</span>}
            <span className="text-[10px] opacity-80 whitespace-nowrap">
              {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isOwn && !isDeleted && (
                isReadByOthers 
                    ? <CheckCheck size={14} className={`${jumboClass ? 'text-brand-500' : 'text-white'} flex-shrink-0`} /> 
                    : <Check size={14} className={`${jumboClass ? 'text-gray-400' : 'text-white/60'} flex-shrink-0`} />
            )}
          </div>

          {!isDeleted && (
            <div className={`flex flex-wrap gap-1 mt-2 -mb-5 relative z-20 ${jumboClass ? 'mt-0 px-2' : ''}`}>
              {Object.entries(reactionData).map(([emoji, { count, hasReacted, users }]) => (
                <div key={emoji} className="relative">
                    <button
                        onClick={(e) => { e.stopPropagation(); setClickedReactionEmoji(clickedReactionEmoji === emoji ? null : emoji); }}
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
                    
                    {/* Reaction Details Modal */}
                    <AnimatePresence>
                        {clickedReactionEmoji === emoji && (
                            <MotionDiv
                                ref={reactionDetailsRef}
                                initial={{ opacity: 0, y: 5, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 5, scale: 0.9 }}
                                className={`absolute bottom-full mb-1 z-30 bg-white dark:bg-gray-800 shadow-xl rounded-xl border border-gray-100 dark:border-gray-700 p-3 min-w-[150px] ${isOwn ? 'right-0' : 'left-0'}`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="text-xs font-bold text-gray-500 uppercase mb-2 pb-1 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                                    <span>Réactions {emoji}</span>
                                    <button onClick={() => setClickedReactionEmoji(null)}><X size={12}/></button>
                                </div>
                                <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                                    {users.length > 0 ? (
                                        users.map((u, i) => (
                                            <div key={i} className="text-sm text-gray-800 dark:text-gray-200 flex justify-between items-center py-0.5">
                                                <span className="truncate max-w-[100px] font-medium">{u}</span>
                                                {hasReacted && user?.username === u && (
                                                    <button 
                                                        onClick={() => { onReact?.(message, emoji); setClickedReactionEmoji(null); }}
                                                        className="text-[10px] text-red-500 hover:text-red-600 ml-2"
                                                    >
                                                        Retirer
                                                    </button>
                                                )}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-xs text-gray-400 block text-center py-1">
                                            {hasReacted ? 'Moi' : 'Chargement...'}
                                        </span>
                                    )}
                                </div>
                            </MotionDiv>
                        )}
                    </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MotionDiv>
  );
};