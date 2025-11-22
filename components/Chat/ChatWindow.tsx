import React, { useEffect, useState, useRef } from 'react';
import { Conversation, Message, User } from '../../types';
import { getMessagesAPI, sendMessageAPI, editMessageAPI, deleteMessageAPI, subscribeToMessages, getOtherParticipant, sendTypingEvent, sendStopTypingEvent, subscribeToTypingEvents, markMessagesAsReadAPI, subscribeToReadReceipts } from '../../services/api';
import { MessageBubble } from './MessageBubble';
import { Send, MoreVertical, Phone, Video, ArrowLeft, Reply, Pencil, X } from 'lucide-react';

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
  
  // Typing Logic
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimeoutRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load Name & Participant Info
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

  // Load history + Subscribe Realtime
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
        } catch(e) {
            console.error(e);
            setLoading(false);
        }
    };
    fetchAndMark();

    const unsubscribeMsgs = subscribeToMessages(conversation.id, (newMessage) => {
        setMessages(prev => {
            const existingIndex = prev.findIndex(m => m.id === newMessage.id);
            if (existingIndex !== -1) {
                const updated = [...prev];
                updated[existingIndex] = newMessage;
                return updated;
            }
            return [...prev, newMessage];
        });
        
        if (!messages.find(m => m.id === newMessage.id)) {
            setTimeout(scrollToBottom, 100);
            if (newMessage.sender_id !== currentUser.id) {
                markMessagesAsReadAPI(conversation.id);
            }
        }
    });

    const unsubscribeTyping = subscribeToTypingEvents(conversation.id, (userId, isTyping) => {
        setTypingUsers(prev => {
            const next = new Set(prev);
            if (isTyping) next.add(userId);
            else next.delete(userId);
            return next;
        });
    });
    
    const unsubscribeReads = subscribeToReadReceipts(conversation.id, () => {
        getMessagesAPI(conversation.id).then(setMessages);
    });

    return () => {
        unsubscribeMsgs();
        unsubscribeTyping();
        unsubscribeReads();
    };
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
        try {
            await editMessageAPI(editingMessage.id, text);
            setEditingMessage(null);
            setInputText('');
        } catch (err) {
            alert("Impossible de modifier le message");
        }
    } else {
        setInputText(''); 
        const replyId = replyingTo ? replyingTo.id : undefined;
        setReplyingTo(null);

        try {
            await sendMessageAPI(conversation.id, currentUser.id, text, replyId);
        } catch (err) {
            setInputText(text);
            setReplyingTo(replyingTo); 
            alert("Erreur d'envoi");
        }
    }
  };

  const handleStartEdit = (msg: Message) => {
      setEditingMessage(msg);
      setReplyingTo(null);
      setInputText(msg.content);
  };

  const handleReply = (msg: Message) => {
      setReplyingTo(msg);
      setEditingMessage(null);
      const input = document.querySelector('input[type="text"]') as HTMLInputElement;
      if(input) input.focus();
  };

  const handleCancelEdit = () => {
      setEditingMessage(null);
      setInputText('');
  };

  const handleCancelReply = () => {
      setReplyingTo(null);
  };

  const handleDelete = async (msg: Message) => {
      if(window.confirm("Supprimer ce message pour tout le monde ?")) {
          try { await deleteMessageAPI(msg.id); } catch (e) { alert("Erreur suppression"); }
      }
  };

  const isOnline = otherUserId && onlineUsers.has(otherUserId);
  const typingCount = typingUsers.size;

  return (
    <div className="flex flex-col h-full relative transition-colors duration-300">
        {/* Header - Optimized for Touch */}
        <div className="h-16 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-2 md:px-4 shadow-sm z-10 shrink-0 transition-colors">
            <div className="flex items-center gap-2 overflow-hidden">
                {/* Back Button: Visible ONLY on mobile */}
                {onBack && (
                    <button 
                        onClick={onBack} 
                        className="md:hidden p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 active:scale-90 transition-all"
                    >
                        <ArrowLeft size={24} />
                    </button>
                )}
                
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 text-white flex items-center justify-center font-bold shadow-sm flex-shrink-0">
                    {headerName?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="overflow-hidden flex flex-col justify-center">
                    <h2 className="text-gray-800 dark:text-gray-100 font-bold text-base leading-tight truncate">{headerName}</h2>
                    <div className="flex items-center gap-1 h-4">
                        {conversation.is_group ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">Groupe</p>
                        ) : (
                            <>
                                {isOnline && <span className="block w-2 h-2 rounded-full bg-green-500 flex-shrink-0 shadow-sm"></span>}
                                <p className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">{isOnline ? 'En ligne' : 'Hors ligne'}</p>
                            </>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-1 md:gap-3 text-orange-700 dark:text-orange-400 flex-shrink-0">
                <button className="cursor-pointer hover:bg-orange-50 dark:hover:bg-gray-700 p-2.5 rounded-full transition-colors active:scale-95"><Video size={22} /></button>
                <button className="cursor-pointer hover:bg-orange-50 dark:hover:bg-gray-700 p-2.5 rounded-full transition-colors active:scale-95"><Phone size={22} /></button>
                <button className="cursor-pointer hover:bg-orange-50 dark:hover:bg-gray-700 p-2.5 rounded-full transition-colors active:scale-95"><MoreVertical size={22} /></button>
            </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-3 pb-4 no-scrollbar touch-pan-y">
            {loading ? (
                <div className="flex justify-center mt-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div></div>
            ) : (
                messages.map(msg => (
                    <MessageBubble 
                        key={msg.id} 
                        message={msg} 
                        isOwn={msg.sender_id === currentUser.id}
                        onEdit={handleStartEdit}
                        onDelete={handleDelete}
                        onReply={handleReply}
                    />
                ))
            )}
            
            {typingCount > 0 && (
                <div className="flex justify-start mb-3 animate-in fade-in slide-in-from-bottom-2">
                    <div className="bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-2xl rounded-tl-sm px-4 py-2 text-xs italic shadow-sm flex items-center gap-2">
                        <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                        </div>
                        <span>train d'écrire...</span>
                    </div>
                </div>
            )}
            
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area - Mobile Safe Area */}
        <div className="w-full bg-white dark:bg-gray-800 px-2 md:px-4 py-3 border-t border-gray-100 dark:border-gray-700 shrink-0 transition-colors safe-area-bottom">
            
            {/* Edit Indicator */}
            {editingMessage && (
                <div className="flex items-center justify-between bg-orange-50 dark:bg-orange-900/20 px-4 py-2 rounded-t-lg border-l-4 border-orange-500 mb-2">
                    <div className="flex flex-col overflow-hidden">
                        <span className="text-xs font-bold text-orange-700 dark:text-orange-400 flex items-center gap-1"><Pencil size={12}/> Modification du message</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{editingMessage.content}</span>
                    </div>
                    <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2">
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Reply Indicator */}
            {replyingTo && (
                <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-t-lg border-l-4 border-blue-500 mb-2 animate-in slide-in-from-bottom-2">
                    <div className="flex flex-col overflow-hidden">
                        <span className="text-xs font-bold text-blue-700 dark:text-blue-400 flex items-center gap-1"><Reply size={12}/> Réponse à {replyingTo.sender_username}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{replyingTo.content}</span>
                    </div>
                    <button onClick={handleCancelReply} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2">
                        <X size={16} />
                    </button>
                </div>
            )}

            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                    type="text"
                    value={inputText}
                    onChange={handleInputChange}
                    placeholder={editingMessage ? "Modifier..." : (replyingTo ? "Répondre..." : "Message")}
                    className={`flex-1 py-3 px-5 rounded-full border focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-gray-50 dark:bg-gray-700 dark:text-white shadow-inner transition-all text-base ${editingMessage ? 'border-orange-300 ring-2 ring-orange-100 dark:ring-orange-900' : 'border-gray-200 dark:border-gray-600'}`}
                    // Prevent zoom on iOS by ensuring font size is 16px
                    style={{ fontSize: '16px' }}
                />
                <button 
                    type="submit" 
                    disabled={!inputText.trim()}
                    className={`p-3 rounded-full text-white shadow-md flex-shrink-0 transform transition-all ${editingMessage ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'} disabled:opacity-50 disabled:hover:bg-orange-600 hover:scale-105 active:scale-95 w-12 h-12 flex items-center justify-center`}
                >
                    <Send size={20} className="ml-0.5" />
                </button>
            </form>
        </div>
    </div>
  );
};