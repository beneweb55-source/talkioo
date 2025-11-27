import React, { useEffect, useState, useRef } from 'react';
import { Conversation, Message, User } from '../../types';
import { getMessagesAPI, sendMessageAPI, editMessageAPI, deleteMessageAPI, subscribeToMessages, getOtherParticipant, sendTypingEvent, sendStopTypingEvent, subscribeToTypingEvents, markMessagesAsReadAPI, subscribeToReadReceipts } from '../../services/api';
import { MessageBubble } from './MessageBubble';
import { Send, Video, Phone, X, Reply, Pencil, ArrowLeft, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatWindowProps {
  conversation: Conversation;
  currentUser: User;
  onBack?: () => void;
  onlineUsers: Set<string>;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ conversation, currentUser, onBack, onlineUsers }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [headerName, setHeaderName] = useState('');
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimeoutRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null); // Ref for auto-resize

  // Fonction de scroll améliorée
  // behavior 'auto' est instantané (essentiel pour le clavier), 'smooth' pour les nouveaux messages
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
      // Utilisation d'un requestAnimationFrame pour s'assurer que le rendu est terminé
      requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      });
  };

  // Auto-resize Textarea
  useEffect(() => {
    if (textareaRef.current) {
        // Reset height to auto to correctly calculate scrollHeight if text is deleted
        textareaRef.current.style.height = 'auto';
        // Set new height based on content, capped at 120px (approx 5 lines)
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  // Keyboard Open Detection for Mobile
  useEffect(() => {
      if (window.visualViewport) {
          const handleResize = () => {
              // Quand le clavier s'ouvre, on force le scroll instantané
              // car le viewport change de taille brutalement
              scrollToBottom('auto');
          };
          
          window.visualViewport.addEventListener('resize', handleResize);
          // iOS a parfois besoin de l'event scroll aussi
          window.visualViewport.addEventListener('scroll', handleResize);
          
          return () => {
              window.visualViewport?.removeEventListener('resize', handleResize);
              window.visualViewport?.removeEventListener('scroll', handleResize);
          };
      }
  }, []);

  const handleInputFocus = () => {
      // Petit délai pour laisser le temps au clavier natif de pousser le viewport
      setTimeout(() => {
          scrollToBottom('auto');
      }, 100);
      
      // Deuxième sécurité pour iOS lent
      setTimeout(() => {
          scrollToBottom('auto');
      }, 300);
  };

  useEffect(() => {
      const loadName = async () => {
        if (conversation.is_group) {
            setHeaderName(conversation.name || 'Groupe');
            setOtherUserId(null);
        } else {
            const other = await getOtherParticipant(conversation.id, currentUser.id);
            if (other) {
                setHeaderName(`${other.username}#${other.tag}`);
                setOtherUserId(other.id);
            } else {
                setHeaderName('Inconnu');
            }
        }
      };
      loadName();
  }, [conversation, currentUser]);

  useEffect(() => {
    setLoading(true);
    setTypingUsers(new Set());
    
    const fetchAndMark = async () => {
        try {
            const data = await getMessagesAPI(conversation.id);
            setMessages(data);
            setLoading(false);
            // Instant scroll au chargement initial
            setTimeout(() => scrollToBottom('auto'), 0);
            await markMessagesAsReadAPI(conversation.id);
        } catch(e) { console.error(e); setLoading(false); }
    };
    fetchAndMark();

    const unsubscribeMsgs = subscribeToMessages(conversation.id, (newMessage) => {
        setMessages(prev => {
            const exists = prev.find(m => m.id === newMessage.id);
            if (exists) return prev.map(m => m.id === newMessage.id ? newMessage : m);
            return [...prev, newMessage];
        });
        if (!messages.find(m => m.id === newMessage.id)) {
            // Smooth scroll pour les nouveaux messages entrants
            scrollToBottom('smooth');
            if (newMessage.sender_id !== currentUser.id) markMessagesAsReadAPI(conversation.id);
        }
    });

    const unsubscribeTyping = subscribeToTypingEvents(conversation.id, (userId, isTyping) => {
        setTypingUsers(prev => {
            const next = new Set(prev);
            if (isTyping) next.add(userId); else next.delete(userId);
            return next;
        });
        // Si quelqu'un tape, on peut vouloir scroller légèrement pour voir l'indicateur
        if(isTyping) scrollToBottom('smooth');
    });
    
    const unsubscribeReads = subscribeToReadReceipts(conversation.id, () => getMessagesAPI(conversation.id).then(setMessages));

    return () => { unsubscribeMsgs(); unsubscribeTyping(); unsubscribeReads(); };
  }, [conversation.id, currentUser.id]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      else sendTypingEvent(conversation.id);
      typingTimeoutRef.current = setTimeout(() => {
          sendStopTypingEvent(conversation.id);
          typingTimeoutRef.current = null;
      }, 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage(e);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    
    if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        sendStopTypingEvent(conversation.id);
    }

    const text = inputText;
    // Clear input immediately for better UX
    setInputText('');
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus(); // Keep focus
    }

    if (editingMessage) {
        try { await editMessageAPI(editingMessage.id, text); setEditingMessage(null); } 
        catch (err) { alert("Erreur modification"); setInputText(text); }
    } else {
        setReplyingTo(null);
        try { await sendMessageAPI(conversation.id, currentUser.id, text, replyingTo?.id); } 
        catch (err) { setInputText(text); alert("Erreur envoi"); }
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        // Limit file size
        if (file.size > 10 * 1024 * 1024) {
            alert("L'image est trop volumineuse (Max 10Mo).");
            return;
        }

        try {
            // Send file directly using updated sendMessageAPI signature (it handles FormData)
            await sendMessageAPI(conversation.id, currentUser.id, '', replyingTo?.id, 'image', file);
            setReplyingTo(null);
        } catch (err) {
            console.error("Erreur envoi image", err);
            alert("Erreur lors de l'envoi de l'image.");
        } finally {
            // Reset input value to allow selecting the same file again
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }
  };

  const isOnline = otherUserId && onlineUsers.has(otherUserId);
  const hasText = inputText.trim().length > 0;

  return (
    <div className="flex flex-col h-full relative bg-[#e5ddd5] dark:bg-[#0b141a]">
        {/* Wallpaper Pattern */}
        <div className="absolute inset-0 z-0 opacity-[0.06] dark:opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }}></div>

        {/* Header - Glassmorphism */}
        <div className="h-[70px] bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50 flex items-center justify-between px-4 z-20 shadow-sm flex-shrink-0">
            <div className="flex items-center gap-3">
                <button onClick={onBack} className="md:hidden p-2 -ml-2 text-gray-600 dark:text-gray-300 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
                    <ArrowLeft size={22} />
                </button>
                <div className="relative">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold shadow-md">
                        {headerName?.charAt(0).toUpperCase()}
                    </div>
                    {isOnline && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-900 rounded-full"></span>}
                </div>
                <div>
                    <h2 className="text-gray-900 dark:text-white font-bold text-sm leading-tight">{headerName}</h2>
                    <p className="text-xs text-brand-600 dark:text-brand-400 font-medium">
                        {conversation.is_group ? 'Groupe' : (isOnline ? 'En ligne' : 'Hors ligne')}
                    </p>
                </div>
            </div>
            <div className="flex gap-3 text-brand-600 dark:text-brand-400">
                <Video className="w-5 h-5 cursor-pointer hover:opacity-70" />
                <Phone className="w-5 h-5 cursor-pointer hover:opacity-70" />
            </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 z-10 no-scrollbar">
            {loading ? (
                <div className="flex justify-center mt-10"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : (
                messages.map(msg => (
                    <MessageBubble 
                        key={msg.id} 
                        message={msg} 
                        isOwn={msg.sender_id === currentUser.id}
                        onEdit={(m) => { setEditingMessage(m); setInputText(m.content); setReplyingTo(null); }}
                        onDelete={async (m) => { if(window.confirm('Supprimer ?')) await deleteMessageAPI(m.id); }}
                        onReply={(m) => { setReplyingTo(m); setEditingMessage(null); textareaRef.current?.focus(); }}
                    />
                ))
            )}
            
            <AnimatePresence>
            {typingUsers.size > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex justify-start">
                    <div className="bg-white dark:bg-gray-800 px-4 py-2 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce"></span>
                        <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce delay-100"></span>
                        <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                </motion.div>
            )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-2 z-20 bg-transparent flex-shrink-0">
            {/* Context Header (Reply/Edit) */}
            <AnimatePresence>
                {(editingMessage || replyingTo) && (
                    <motion.div 
                        initial={{ height: 0, opacity: 0, marginBottom: 0 }} 
                        animate={{ height: 'auto', opacity: 1, marginBottom: 8 }} 
                        exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                        className="mx-2 px-4 py-2 border-l-4 border-brand-500 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-r-lg shadow-sm flex justify-between items-center overflow-hidden"
                    >
                        <div className="text-xs overflow-hidden">
                            <span className={`font-bold flex items-center gap-1 mb-0.5 ${editingMessage ? 'text-brand-600' : 'text-blue-500'}`}>
                                {editingMessage ? <><Pencil size={10}/> Modification</> : <><Reply size={10}/> Réponse à {replyingTo?.sender_username}</>}
                            </span>
                            <div className="text-gray-600 dark:text-gray-300 truncate max-w-[200px]">{editingMessage?.content || replyingTo?.content}</div>
                        </div>
                        <button onClick={() => { setEditingMessage(null); setReplyingTo(null); setInputText(''); }} className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                            <X size={14} className="text-gray-500" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Bottom Bar Container */}
            <div className="flex items-end gap-2 px-2 pb-2">
                
                {/* Plus/Attachment Button */}
                <div className="flex-shrink-0 mb-1">
                    <button onClick={() => fileInputRef.current?.click()} className="h-10 w-10 md:h-12 md:w-12 rounded-full flex items-center justify-center bg-gray-200 dark:bg-gray-800 text-gray-500 hover:text-brand-500 dark:text-gray-400 transition-colors shadow-sm">
                        <Plus size={20} />
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="image/*" 
                        onChange={handleImageSelect}
                    />
                </div>

                {/* Text Input Container */}
                <div className="flex-1 bg-white dark:bg-gray-900 rounded-[24px] shadow-sm border border-gray-200 dark:border-gray-800 flex items-end overflow-hidden min-h-[50px]">
                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onFocus={handleInputFocus}
                        rows={1}
                        placeholder="Écrivez votre message..."
                        className="w-full bg-transparent border-none outline-none text-gray-800 dark:text-white px-4 py-3.5 placeholder-gray-400 resize-none max-h-[120px] overflow-y-auto leading-relaxed scrollbar-hide"
                        style={{ minHeight: '50px' }}
                    />
                </div>

                {/* Send Button */}
                <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    disabled={!hasText}
                    onClick={handleSendMessage}
                    className={`flex-shrink-0 mb-1 h-12 w-12 rounded-full flex items-center justify-center shadow-md transition-all duration-200
                        ${hasText 
                            ? 'bg-brand-500 text-white shadow-brand-500/30 hover:bg-brand-600' 
                            : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'}
                    `}
                >
                    <Send size={20} className={`ml-0.5 ${hasText ? 'text-white' : 'text-gray-400'}`} />
                </motion.button>
            </div>
        </div>
    </div>
  );
};