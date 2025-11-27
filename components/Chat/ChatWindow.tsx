import React, { useEffect, useState, useRef } from 'react';
import { Conversation, Message, User } from '../../types';
import { getMessagesAPI, sendMessageAPI, editMessageAPI, deleteMessageAPI, subscribeToMessages, getOtherParticipant, sendTypingEvent, sendStopTypingEvent, subscribeToTypingEvents, markMessagesAsReadAPI, subscribeToReadReceipts } from '../../services/api';
import { MessageBubble } from './MessageBubble';
import { Send, MoreVertical, Phone, Video, X, Reply, Pencil, ArrowLeft } from 'lucide-react';
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

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

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
            setTimeout(scrollToBottom, 100);
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
            setTimeout(scrollToBottom, 100);
            if (newMessage.sender_id !== currentUser.id) markMessagesAsReadAPI(conversation.id);
        }
    });

    const unsubscribeTyping = subscribeToTypingEvents(conversation.id, (userId, isTyping) => {
        setTypingUsers(prev => {
            const next = new Set(prev);
            if (isTyping) next.add(userId); else next.delete(userId);
            return next;
        });
    });
    
    const unsubscribeReads = subscribeToReadReceipts(conversation.id, () => getMessagesAPI(conversation.id).then(setMessages));

    return () => { unsubscribeMsgs(); unsubscribeTyping(); unsubscribeReads(); };
  }, [conversation.id, currentUser.id]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      else sendTypingEvent(conversation.id);
      typingTimeoutRef.current = setTimeout(() => {
          sendStopTypingEvent(conversation.id);
          typingTimeoutRef.current = null;
      }, 2000);
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
    if (editingMessage) {
        try { await editMessageAPI(editingMessage.id, text); setEditingMessage(null); setInputText(''); } 
        catch (err) { alert("Erreur modification"); }
    } else {
        setInputText(''); setReplyingTo(null);
        try { await sendMessageAPI(conversation.id, currentUser.id, text, replyingTo?.id); } 
        catch (err) { setInputText(text); alert("Erreur envoi"); }
    }
  };

  const isOnline = otherUserId && onlineUsers.has(otherUserId);

  return (
    <div className="flex flex-col h-full relative bg-[#e5ddd5] dark:bg-[#0b141a]">
        {/* Wallpaper Pattern */}
        <div className="absolute inset-0 z-0 opacity-[0.06] dark:opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }}></div>

        {/* Header - Glassmorphism */}
        <div className="h-[70px] bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50 flex items-center justify-between px-4 z-20 shadow-sm">
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
                        onReply={(m) => { setReplyingTo(m); setEditingMessage(null); document.querySelector('input')?.focus(); }}
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
        <div className="p-3 z-20 bg-transparent">
            <div className="bg-white dark:bg-gray-900 rounded-[24px] shadow-lg border border-gray-100 dark:border-gray-800 p-2 relative">
                
                {/* Context Header (Reply/Edit) */}
                <AnimatePresence>
                    {(editingMessage || replyingTo) && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }} 
                            animate={{ height: 'auto', opacity: 1 }} 
                            exit={{ height: 0, opacity: 0 }}
                            className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50 rounded-t-xl mb-1"
                        >
                            <div className="text-xs">
                                <span className={`font-bold flex items-center gap-1 ${editingMessage ? 'text-brand-600' : 'text-blue-500'}`}>
                                    {editingMessage ? <><Pencil size={10}/> Modification</> : <><Reply size={10}/> Réponse à {replyingTo?.sender_username}</>}
                                </span>
                                <div className="text-gray-500 truncate max-w-[200px]">{editingMessage?.content || replyingTo?.content}</div>
                            </div>
                            <button onClick={() => { setEditingMessage(null); setReplyingTo(null); setInputText(''); }} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                                <X size={14} className="text-gray-500" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <form onSubmit={handleSendMessage} className="flex items-center gap-2 pl-2">
                    <input
                        type="text"
                        value={inputText}
                        onChange={handleInputChange}
                        placeholder="Écrivez votre message..."
                        className="flex-1 bg-transparent border-none outline-none text-gray-800 dark:text-white px-2 py-3 placeholder-gray-400"
                    />
                    <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        disabled={!inputText.trim()}
                        type="submit" 
                        className="w-10 h-10 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 rounded-full flex items-center justify-center text-white shadow-md transition-colors"
                    >
                        <Send size={18} className="ml-0.5" />
                    </motion.button>
                </form>
            </div>
        </div>
    </div>
  );
};