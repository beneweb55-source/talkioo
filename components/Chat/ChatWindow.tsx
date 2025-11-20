import React, { useEffect, useState, useRef } from 'react';
import { Conversation, Message, User } from '../../types';
import { getMessagesAPI, sendMessageAPI, editMessageAPI, deleteMessageAPI, subscribeToMessages, getOtherParticipant } from '../../services/mockBackend';
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
    getMessagesAPI(conversation.id).then(data => {
      setMessages(data);
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    });

    const unsubscribe = subscribeToMessages(conversation.id, (newMessage) => {
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

    return () => {
        unsubscribe();
    };
  }, [conversation.id]);

  // --- ACTIONS ---

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText;
    
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
        {/* Header */}
        <div className="h-16 bg-white/90 backdrop-blur-md border-b border-gray-200 flex items-center justify-between px-4 shadow-sm z-10">
            <div className="flex items-center gap-3">
                {onBack && (
                    <button onClick={onBack} className="md:hidden text-gray-600 hover:bg-gray-100 p-1 rounded-full">
                        <ArrowLeft size={20} />
                    </button>
                )}
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 text-white flex items-center justify-center font-bold shadow-sm">
                    {headerName?.charAt(0).toUpperCase() || '?'}
                </div>
                <div>
                    <h2 className="text-gray-800 font-semibold text-base leading-tight">{headerName}</h2>
                    <div className="flex items-center gap-1">
                        <span className="block w-2 h-2 rounded-full bg-green-500"></span>
                        <p className="text-xs text-gray-500 font-medium">{conversation.is_group ? 'Membres' : 'En ligne'}</p>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-4 text-orange-700">
                <Video className="cursor-pointer hover:bg-orange-50 p-2 rounded-full box-content transition-colors" size={20} />
                <Phone className="cursor-pointer hover:bg-orange-50 p-2 rounded-full box-content transition-colors" size={20} />
                <MoreVertical className="cursor-pointer hover:bg-orange-50 p-2 rounded-full box-content transition-colors" size={20} />
            </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 pb-4 no-scrollbar">
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

        {/* Input Area */}
        <div className="w-full bg-white px-4 py-3 border-t border-gray-100">
            {editingMessage && (
                <div className="flex items-center justify-between bg-orange-50 px-4 py-2 rounded-t-lg border-l-4 border-orange-500 mb-2">
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-orange-700">Modification du message</span>
                        <span className="text-xs text-gray-500 truncate max-w-[200px]">{editingMessage.content}</span>
                    </div>
                    <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-600">
                        <X size={16} />
                    </button>
                </div>
            )}
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={editingMessage ? "Modifier votre message..." : "Écrivez un message..."}
                    className={`flex-1 py-3 px-4 rounded-full border focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-gray-50 shadow-inner transition-all ${editingMessage ? 'border-orange-300 ring-2 ring-orange-100' : 'border-gray-200'}`}
                />
                <button 
                    type="submit" 
                    disabled={!inputText.trim()}
                    className={`p-3 rounded-full text-white shadow-md flex-shrink-0 transform transition-all ${editingMessage ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'} disabled:opacity-50 disabled:hover:bg-orange-600 hover:scale-105 active:scale-95`}
                >
                    <Send size={20} className="ml-0.5" />
                </button>
            </form>
        </div>
    </div>
  );
};