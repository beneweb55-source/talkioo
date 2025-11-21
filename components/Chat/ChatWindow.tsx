import React, { useEffect, useState, useRef } from 'react';
import { Conversation, Message, User } from '../../types';
import { 
    getMessagesAPI, 
    sendMessageAPI, 
    editMessageAPI, 
    deleteMessageAPI, 
    subscribeToMessages, 
    getOtherParticipant,
    sendTypingEvent,
    subscribeToTypingEvents
} from '../../services/api';
import { MessageBubble } from './MessageBubble';
import { Send, MoreVertical, Phone, Video, ArrowLeft, X } from 'lucide-react';

interface ChatWindowProps {
  conversation: Conversation;
  currentUser: User;
  onBack?: () => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ conversation, currentUser, onBack }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [headerName, setHeaderName] = useState('');
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  
  // Typing Indicators State
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load Name
  useEffect(() => {
      const loadName = async () => {
        if (conversation.is_group) {
            setHeaderName(conversation.name || 'Groupe');
        } else {
            const other = await getOtherParticipant(conversation.id, currentUser.id);
            setHeaderName(other ? `${other.username}#${other.tag}` : 'Inconnu');
        }
      };
      loadName();
  }, [conversation, currentUser]);

  // Load history + Subscribe Realtime
  useEffect(() => {
    setLoading(true);
    setTypingUsers(new Set()); // Reset typing state on switch
    
    getMessagesAPI(conversation.id).then(data => {
      setMessages(data);
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    });

    const unsubscribeMessages = subscribeToMessages(conversation.id, (newMessage) => {
        setMessages(prev => {
            // Check if it's an update to an existing message (Edit/Delete)
            const existingIndex = prev.findIndex(m => m.id === newMessage.id);
            if (existingIndex !== -1) {
                const updated = [...prev];
                updated[existingIndex] = newMessage;
                return updated;
            }
            // Or a new message
            return [...prev, newMessage];
        });
        
        // Only scroll if it's a new message, not an edit
        if (!messages.find(m => m.id === newMessage.id)) {
            setTimeout(scrollToBottom, 100);
        }
    });

    // Subscribe to Typing Events
    const unsubscribeTyping = subscribeToTypingEvents(
        conversation.id,
        (username) => {
            // Defensive check: Don't show typing for self
            if (username === currentUser.username) return;

            setTypingUsers(prev => {
                const next = new Set(prev);
                next.add(username);
                return next;
            });
            scrollToBottom();
        },
        (username) => {
            setTypingUsers(prev => {
                const next = new Set(prev);
                next.delete(username);
                return next;
            });
        }
    );

    return () => {
        unsubscribeMessages();
        unsubscribeTyping();
    };
  }, [conversation.id, currentUser.username]);

  // --- ACTIONS ---

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);

      // Typing Logic
      if (!editingMessage) {
          if (!isTypingRef.current) {
              isTypingRef.current = true;
              sendTypingEvent(conversation.id, true, currentUser.username);
          }

          // Debounce stop
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          
          typingTimeoutRef.current = setTimeout(() => {
              isTypingRef.current = false;
              sendTypingEvent(conversation.id, false, currentUser.username);
          }, 2000);
      }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText;
    
    // Reset typing immediately on send
    if (isTypingRef.current) {
        isTypingRef.current = false;
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        sendTypingEvent(conversation.id, false, currentUser.username);
    }

    if (editingMessage) {
        // EDIT MODE
        try {
            await editMessageAPI(editingMessage.id, text);
            setEditingMessage(null);
            setInputText('');
        } catch (err) {
            console.error("Failed to edit", err);
            alert("Impossible de modifier le message");
        }
    } else {
        // SEND MODE
        setInputText(''); 
        try {
            await sendMessageAPI(conversation.id, currentUser.id, text);
        } catch (err) {
            console.error("Failed to send", err);
            setInputText(text);
            alert("Erreur d'envoi");
        }
    }
  };

  const handleStartEdit = (msg: Message) => {
      setEditingMessage(msg);
      setInputText(msg.content);
  };

  const handleCancelEdit = () => {
      setEditingMessage(null);
      setInputText('');
  };

  const handleDelete = async (msg: Message) => {
      if(window.confirm("Supprimer ce message pour tout le monde ?")) {
          try {
              await deleteMessageAPI(msg.id);
          } catch (e) {
              console.error(e);
              alert("Erreur suppression");
          }
      }
  };

  return (
    <div className="flex flex-col h-full bg-[#e5ddd5] relative">
        {/* Header - Height 56px on mobile for compact feel, 64px on desktop */}
        <div className="h-14 md:h-16 bg-white/90 backdrop-blur-md border-b border-gray-200 flex items-center justify-between px-2 md:px-4 shadow-sm z-10 flex-shrink-0">
            <div className="flex items-center gap-2 overflow-hidden">
                {onBack && (
                    <button 
                        onClick={onBack} 
                        className="md:hidden text-gray-600 hover:bg-gray-100 active:bg-gray-200 p-2 -ml-1 rounded-full transition-colors"
                        aria-label="Retour"
                    >
                        <ArrowLeft size={24} />
                    </button>
                )}
                <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 text-white flex items-center justify-center font-bold shadow-sm flex-shrink-0">
                    {headerName?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="flex flex-col justify-center overflow-hidden">
                    <h2 className="text-gray-800 font-semibold text-sm md:text-base leading-tight truncate">{headerName}</h2>
                    <div className="flex items-center gap-1">
                        <span className="block w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                        <p className="text-[10px] md:text-xs text-gray-500 font-medium truncate">{conversation.is_group ? 'Membres' : 'En ligne'}</p>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-1 md:gap-4 text-orange-700">
                <button className="cursor-pointer hover:bg-orange-50 active:bg-orange-100 p-2 rounded-full transition-colors">
                    <Video size={20} />
                </button>
                <button className="cursor-pointer hover:bg-orange-50 active:bg-orange-100 p-2 rounded-full transition-colors">
                    <Phone size={20} />
                </button>
                <button className="cursor-pointer hover:bg-orange-50 active:bg-orange-100 p-2 rounded-full transition-colors">
                    <MoreVertical size={20} />
                </button>
            </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 pb-2 no-scrollbar overscroll-contain">
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
                    />
                ))
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Typing Indicator Area */}
        <div className="px-4 py-1 h-6 flex-shrink-0">
            {typingUsers.size > 0 && (
                <div className="text-xs text-gray-500 italic flex items-center gap-1 animate-pulse">
                    <div className="flex space-x-1 mr-1">
                        <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                        <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    {Array.from(typingUsers).join(', ')} {typingUsers.size > 1 ? 'écrivent...' : 'écrit...'}
                </div>
            )}
        </div>

        {/* Input Area - Safe area padding for iPhone X+ */}
        <div className="w-full bg-white px-3 py-2 md:px-4 md:py-3 border-t border-gray-100 shrink-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            {editingMessage && (
                <div className="flex items-center justify-between bg-orange-50 px-4 py-2 rounded-t-lg border-l-4 border-orange-500 mb-2">
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-orange-700">Modification du message</span>
                        <span className="text-xs text-gray-500 truncate max-w-[200px]">{editingMessage.content}</span>
                    </div>
                    <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600 p-2">
                        <X size={16} />
                    </button>
                </div>
            )}
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                    type="text"
                    value={inputText}
                    onChange={handleInputChange}
                    placeholder={editingMessage ? "Modifier..." : "Message..."}
                    className={`flex-1 py-2.5 px-4 rounded-full border focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-gray-50 shadow-inner transition-all text-base md:text-sm ${editingMessage ? 'border-orange-300 ring-2 ring-orange-100' : 'border-gray-200'}`}
                />
                <button 
                    type="submit" 
                    disabled={!inputText.trim()}
                    className={`p-3 rounded-full text-white shadow-md flex-shrink-0 transform transition-all ${editingMessage ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700 active:scale-95'} disabled:opacity-50 disabled:hover:bg-orange-600`}
                >
                    <Send size={20} className="ml-0.5" />
                </button>
            </form>
        </div>
    </div>
  );
};