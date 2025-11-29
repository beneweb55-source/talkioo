import React, { useEffect, useState, useRef } from 'react';
import { Conversation, Message, User } from '../../types';
import { getMessagesAPI, sendMessageAPI, editMessageAPI, deleteMessageAPI, subscribeToMessages, getOtherParticipant, sendTypingEvent, sendStopTypingEvent, subscribeToTypingEvents, markMessagesAsReadAPI, subscribeToReadReceipts, reactToMessageAPI, subscribeToReactionUpdates, subscribeToUserProfileUpdates } from '../../services/api';
import { MessageBubble } from './MessageBubble';
import { Send, Video, Phone, X, Reply, Pencil, ArrowLeft, Image, Loader2, Smile, Search, ChevronDown, ChevronUp, Users, Info, StickyNote } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { GroupManager } from '../Groups/GroupManager'; 
import { GifPicker } from './GifPicker';

const MotionDiv = motion.div as any;
const MotionButton = motion.button as any;

interface ChatWindowProps {
  conversation: Conversation;
  currentUser: User;
  onBack?: () => void;
  onlineUsers: Set<string>;
  contacts: User[]; // New prop for adding members
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ conversation, currentUser, onBack, onlineUsers, contacts }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [headerName, setHeaderName] = useState('');
  const [headerAvatar, setHeaderAvatar] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const [showInputEmoji, setShowInputEmoji] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false); // NEW STATE
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false); 

  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimeoutRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const gifPickerRef = useRef<HTMLDivElement>(null); // NEW REF
  
  const isInsertingEmojiRef = useRef(false);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
      requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      });
  };

  useEffect(() => {
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputText]);

  useEffect(() => {
      if (isSearchOpen && searchInputRef.current) {
          searchInputRef.current.focus();
      }
      if (!isSearchOpen) {
          setSearchQuery('');
          setSearchMatches([]);
          setCurrentMatchIndex(0);
      }
  }, [isSearchOpen]);

  useEffect(() => {
    if (!searchQuery.trim()) {
        setSearchMatches([]);
        return;
    }

    const term = searchQuery.toLowerCase();
    const matches = messages
        .filter(m => m.content && m.content.toLowerCase().includes(term))
        .map(m => m.id);
    
    setSearchMatches(matches);
    
    if (matches.length > 0) {
        setCurrentMatchIndex(matches.length - 1);
        scrollToMessage(matches[matches.length - 1]);
    }
  }, [searchQuery, messages]);

  const scrollToMessage = (messageId: string) => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
  };

  const handleNextMatch = () => {
      if (searchMatches.length === 0) return;
      const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
      setCurrentMatchIndex(nextIndex);
      scrollToMessage(searchMatches[nextIndex]);
  };

  const handlePrevMatch = () => {
      if (searchMatches.length === 0) return;
      const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
      setCurrentMatchIndex(prevIndex);
      scrollToMessage(searchMatches[prevIndex]);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node) && 
            !(event.target as Element).closest('.emoji-toggle-btn')) {
            setShowInputEmoji(false);
        }
        if (gifPickerRef.current && !gifPickerRef.current.contains(event.target as Node) && 
            !(event.target as Element).closest('.gif-toggle-btn')) {
            setShowGifPicker(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
      if (window.visualViewport) {
          const handleResize = () => {
              if (!isSearchOpen) scrollToBottom('auto');
          };
          window.visualViewport.addEventListener('resize', handleResize);
          window.visualViewport.addEventListener('scroll', handleResize);
          return () => {
              window.visualViewport?.removeEventListener('resize', handleResize);
              window.visualViewport?.removeEventListener('scroll', handleResize);
          };
      }
  }, [isSearchOpen]);

  const handleInputFocus = () => {
      if (!isInsertingEmojiRef.current) {
          setShowInputEmoji(false);
          setShowGifPicker(false);
      }
      setTimeout(() => scrollToBottom('auto'), 100);
      setTimeout(() => scrollToBottom('auto'), 300);
  };

  useEffect(() => {
      const loadName = async () => {
        if (conversation.is_group) {
            setHeaderName(conversation.name || 'Groupe');
            setHeaderAvatar(conversation.avatar_url || null);
            setOtherUserId(null);
        } else {
            const other = await getOtherParticipant(conversation.id, currentUser.id);
            if (other) {
                setHeaderName(`${other.username}#${other.tag}`);
                setHeaderAvatar(other.avatar_url || null);
                setOtherUserId(other.id);
            } else {
                setHeaderName('Inconnu');
                setHeaderAvatar(null);
            }
        }
      };
      loadName();
  }, [conversation, currentUser]);

  useEffect(() => {
    setLoading(true);
    setTypingUsers(new Set());
    setSelectedFile(null);
    setImagePreview(null);
    setIsSearchOpen(false);
    setIsGroupInfoOpen(false); 
    
    const fetchAndMark = async () => {
        try {
            const data = await getMessagesAPI(conversation.id);
            setMessages(data);
            setLoading(false);
            setTimeout(() => scrollToBottom('auto'), 0);
            await markMessagesAsReadAPI(conversation.id);
        } catch(e) { console.error(e); setLoading(false); }
    };
    fetchAndMark();

    const unsubscribeMsgs = subscribeToMessages(conversation.id, (newMessage) => {
        setMessages(prev => {
            const exists = prev.find(m => m.id === newMessage.id);
            if (exists) {
                if (exists.attachment_url && !newMessage.attachment_url) {
                    return prev.map(m => m.id === newMessage.id ? { 
                        ...newMessage, 
                        attachment_url: exists.attachment_url,
                        image_url: exists.attachment_url 
                    } : m);
                }
                return prev.map(m => m.id === newMessage.id ? newMessage : m);
            }
            return [...prev, newMessage];
        });
        
        if (!isSearchOpen) scrollToBottom('smooth');
        
        if (newMessage.sender_id !== currentUser.id) markMessagesAsReadAPI(conversation.id);
    });

    const unsubscribeReactions = subscribeToReactionUpdates(conversation.id, (messageId, reactions) => {
        setMessages(prev => prev.map(msg => 
            msg.id === messageId ? { ...msg, reactions } : msg
        ));
    });

    const unsubscribeTyping = subscribeToTypingEvents(conversation.id, (userId, isTyping) => {
        setTypingUsers(prev => {
            const next = new Set(prev);
            if (isTyping) next.add(userId); else next.delete(userId);
            return next;
        });
        if(isTyping && !isSearchOpen) scrollToBottom('smooth');
    });
    
    const unsubscribeReads = subscribeToReadReceipts(conversation.id, () => getMessagesAPI(conversation.id).then(setMessages));

    const unsubscribeProfile = subscribeToUserProfileUpdates((updatedUser) => {
        if (otherUserId === updatedUser.id) {
            setHeaderName(`${updatedUser.username}#${updatedUser.tag}`);
            setHeaderAvatar(updatedUser.avatar_url || null);
        }
        setMessages(prev => prev.map(m => {
            if (m.sender_id === updatedUser.id) {
                return { ...m, sender_username: `${updatedUser.username}#${updatedUser.tag}` };
            }
            return m;
        }));
    });

    return () => { unsubscribeMsgs(); unsubscribeTyping(); unsubscribeReads(); unsubscribeReactions(); unsubscribeProfile(); };
  }, [conversation.id, currentUser.id, otherUserId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      else sendTypingEvent(conversation.id);
      typingTimeoutRef.current = setTimeout(() => {
          sendStopTypingEvent(conversation.id);
          typingTimeoutRef.current = null;
      }, 2000);
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    isInsertingEmojiRef.current = true;
    const cursor = textareaRef.current?.selectionStart || inputText.length;
    const text = inputText.slice(0, cursor) + emojiData.emoji + inputText.slice(cursor);
    setInputText(text);
    setTimeout(() => {
        if(textareaRef.current) {
            textareaRef.current.focus();
            const newCursor = cursor + emojiData.emoji.length;
            textareaRef.current.setSelectionRange(newCursor, newCursor);
        }
        setTimeout(() => { isInsertingEmojiRef.current = false; }, 50);
    }, 10);
  };

  const handleGifSelect = async (gifUrl: string) => {
      setShowGifPicker(false);
      try {
          await sendMessageAPI(conversation.id, currentUser.id, '', undefined, 'gif', undefined, gifUrl);
          // Optimistic update handled by socket subscription mostly, but we can add temp if needed
      } catch (err) { console.error("GIF send error", err); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage(e);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            alert("Format non supporté.");
            e.target.value = ''; 
            return;
        }
        const maxSize = 10 * 1024 * 1024; 
        if (file.size > maxSize) {
            alert("Image trop volumineuse. (Max 10Mo).");
            e.target.value = ''; 
            return;
        }
        const previewUrl = URL.createObjectURL(file);
        setSelectedFile(file);
        setImagePreview(previewUrl);
        e.target.value = ''; 
    }
  };

  const cancelImage = () => {
      setSelectedFile(null);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
  };

  const handleReaction = async (msg: Message, emoji: string) => {
      try { await reactToMessageAPI(msg.id, emoji); } 
      catch (error) { console.error("Reaction failed", error); }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !selectedFile) || isSending) return;
    
    setIsSending(true);
    setShowInputEmoji(false);
    setShowGifPicker(false);
    
    if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        sendStopTypingEvent(conversation.id);
    }

    const textToSend = inputText;
    const fileToSend = selectedFile; 
    const currentPreview = imagePreview; 

    setInputText('');
    setSelectedFile(null);
    setImagePreview(null);
    setReplyingTo(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const tempId = 'temp_' + Date.now();
    const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_id: currentUser.id,
        content: textToSend,
        created_at: new Date().toISOString(),
        sender_username: currentUser.username,
        message_type: fileToSend ? 'image' : 'text',
        attachment_url: currentPreview || undefined, 
        read_count: 0
    };

    if (!editingMessage) {
        setMessages(prev => [...prev, optimisticMsg]);
        scrollToBottom('smooth');
    }

    try {
        if (editingMessage && !fileToSend) {
            await editMessageAPI(editingMessage.id, textToSend);
            setEditingMessage(null);
        } else {
            const newMessage = await sendMessageAPI(
                conversation.id, 
                currentUser.id, 
                textToSend, 
                replyingTo?.id, 
                fileToSend ? 'image' : 'text',
                fileToSend || undefined
            );

            setMessages(prev => {
                const alreadyExists = prev.find(m => m.id === newMessage.id);
                if (alreadyExists) {
                    if (!alreadyExists.attachment_url && newMessage.attachment_url) {
                         return prev.map(m => m.id === newMessage.id ? newMessage : m).filter(m => m.id !== tempId);
                    }
                    return prev.filter(m => m.id !== tempId);
                }
                return prev.map(m => m.id === tempId ? newMessage : m);
            });
        }
    } catch (err: any) {
        console.error("Erreur envoi:", err);
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setInputText(textToSend);
        if (fileToSend) {
            setSelectedFile(fileToSend);
            setImagePreview(currentPreview);
        }
    } finally {
        setIsSending(false);
    }
  };

  const isOnline = otherUserId && onlineUsers.has(otherUserId);
  const canSend = (inputText.trim().length > 0 || selectedFile !== null) && !isSending;

  return (
    <div className="flex flex-col h-full relative bg-[#e5ddd5] dark:bg-[#0b141a]">
        <div className="absolute inset-0 z-0 opacity-[0.06] dark:opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70fcded21.png')" }}></div>

        {/* --- GROUP MANAGER OVERLAY --- */}
        <AnimatePresence>
            {isGroupInfoOpen && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <GroupManager 
                        conversation={conversation}
                        currentUser={currentUser}
                        contacts={contacts}
                        onClose={() => setIsGroupInfoOpen(false)}
                        onUpdate={() => {}}
                    />
                </div>
            )}
        </AnimatePresence>

        <div className="h-[70px] bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50 flex items-center justify-between px-4 z-20 shadow-sm flex-shrink-0">
            {isSearchOpen ? (
                <div className="flex-1 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex-1 relative">
                        <input 
                            ref={searchInputRef}
                            type="text" 
                            placeholder="Rechercher..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-xl py-2 pl-4 pr-12 focus:ring-2 focus:ring-brand-500/20 text-sm outline-none dark:text-white"
                        />
                        {searchMatches.length > 0 && (
                             <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <span className="text-xs text-gray-400 mr-1">
                                    {currentMatchIndex + 1}/{searchMatches.length}
                                </span>
                                <div className="flex bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
                                    <button onClick={handlePrevMatch} className="p-1 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300">
                                        <ChevronUp size={14} />
                                    </button>
                                    <div className="w-[1px] bg-gray-300 dark:bg-gray-600"></div>
                                    <button onClick={handleNextMatch} className="p-1 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300">
                                        <ChevronDown size={14} />
                                    </button>
                                </div>
                             </div>
                        )}
                    </div>
                    <button onClick={() => setIsSearchOpen(false)} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full">
                        <X size={20} />
                    </button>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="md:hidden p-2 -ml-2 text-gray-600 dark:text-gray-300 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
                            <ArrowLeft size={22} />
                        </button>
                        
                        {/* Header Info - Clickable for Groups */}
                        <div 
                            className={`flex items-center gap-3 ${conversation.is_group ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                            onClick={() => conversation.is_group && setIsGroupInfoOpen(true)}
                        >
                            <div className="relative">
                                <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold shadow-md overflow-hidden">
                                    {headerAvatar ? (
                                        <img src={headerAvatar} alt={headerName} className="h-full w-full object-cover" />
                                    ) : (
                                        conversation.is_group ? <Users size={20} /> : headerName?.charAt(0).toUpperCase()
                                    )}
                                </div>
                                {isOnline && !conversation.is_group && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-900 rounded-full"></span>}
                            </div>
                            <div>
                                <h2 className="text-gray-900 dark:text-white font-bold text-sm leading-tight flex items-center gap-1">
                                    {headerName}
                                    {conversation.is_group && <Info size={12} className="text-gray-400"/>}
                                </h2>
                                <p className="text-xs text-brand-600 dark:text-brand-400 font-medium">
                                    {conversation.is_group ? 'Cliquez pour gérer' : (isOnline ? 'En ligne' : 'Hors ligne')}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-1 text-brand-600 dark:text-brand-400">
                        <button onClick={() => setIsSearchOpen(true)} className="p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors">
                            <Search size={20} />
                        </button>
                    </div>
                </>
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 z-10 no-scrollbar relative">
            {loading ? (
                <div className="flex justify-center mt-10"><Loader2 className="animate-spin text-brand-500" size={32} /></div>
            ) : (
                <>
                    {messages.map(msg => (
                        <MessageBubble 
                            key={msg.id} 
                            message={msg} 
                            isOwn={msg.sender_id === currentUser.id}
                            onEdit={(m) => { setEditingMessage(m); setInputText(m.content); setReplyingTo(null); cancelImage(); }}
                            onDelete={async (m) => { if(window.confirm('Supprimer ?')) await deleteMessageAPI(m.id); }}
                            onReply={(m) => { setReplyingTo(m); setEditingMessage(null); textareaRef.current?.focus(); }}
                            onReact={handleReaction}
                            highlightTerm={searchQuery}
                        />
                    ))}
                </>
            )}
            <AnimatePresence>
            {typingUsers.size > 0 && (
                <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex justify-start">
                    <div className="bg-white dark:bg-gray-800 px-4 py-2 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce"></span>
                        <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce delay-100"></span>
                        <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                </MotionDiv>
            )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
        </div>

        <div className="p-2 z-20 bg-transparent flex-shrink-0 relative">
            <AnimatePresence>
                {showInputEmoji && (
                    <MotionDiv 
                        ref={emojiPickerRef}
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        className="absolute bottom-full mb-2 left-2 z-50 shadow-2xl rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800"
                        style={{ width: 'min(350px, 90vw)' }}
                    >
                        <EmojiPicker 
                            theme={Theme.AUTO}
                            onEmojiClick={onEmojiClick}
                            searchPlaceHolder="Rechercher..."
                            width="100%"
                            height={400}
                        />
                    </MotionDiv>
                )}
                {showGifPicker && (
                    <MotionDiv 
                        ref={gifPickerRef}
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        className="absolute bottom-full mb-2 left-2 z-50 shadow-2xl rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800"
                        style={{ width: 'min(350px, 90vw)', height: '400px' }}
                    >
                        <GifPicker onSelect={handleGifSelect} />
                    </MotionDiv>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {(editingMessage || replyingTo || imagePreview) && (
                    <MotionDiv 
                        initial={{ height: 0, opacity: 0, marginBottom: 0 }} 
                        animate={{ height: 'auto', opacity: 1, marginBottom: 8 }} 
                        exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                        className="mx-2 px-4 py-2 border-l-4 border-brand-500 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-r-lg shadow-sm flex justify-between items-center overflow-hidden"
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            {imagePreview && (
                                <div className="h-12 w-12 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0 relative">
                                    <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
                                </div>
                            )}
                            <div className="text-xs overflow-hidden">
                                {imagePreview ? (
                                    <span className="font-bold text-brand-600 flex items-center gap-1">
                                        <Image size={12}/> Image sélectionnée
                                    </span>
                                ) : (
                                    <span className={`font-bold flex items-center gap-1 mb-0.5 ${editingMessage ? 'text-brand-600' : 'text-blue-500'}`}>
                                        {editingMessage ? <><Pencil size={10}/> Modification</> : <><Reply size={10}/> Réponse à {replyingTo?.sender_username}</>}
                                    </span>
                                )}
                                <div className="text-gray-600 dark:text-gray-300 truncate max-w-[200px]">
                                    {imagePreview ? "Prêt à envoyer..." : (editingMessage?.content || replyingTo?.content)}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => { setEditingMessage(null); setReplyingTo(null); setInputText(''); cancelImage(); }} className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                            <X size={14} className="text-gray-500" />
                        </button>
                    </MotionDiv>
                )}
            </AnimatePresence>

            <div className="flex items-end gap-2 px-2 pb-2">
                <div className="flex-shrink-0 mb-1 flex gap-2">
                     <button onClick={() => { setShowInputEmoji(!showInputEmoji); setShowGifPicker(false); }} className={`emoji-toggle-btn h-10 w-10 md:h-12 md:w-12 rounded-full flex items-center justify-center transition-colors shadow-sm ${showInputEmoji ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/30' : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        <Smile size={24} />
                     </button>
                     <button onClick={() => { setShowGifPicker(!showGifPicker); setShowInputEmoji(false); }} className={`gif-toggle-btn h-10 w-10 md:h-12 md:w-12 rounded-full flex items-center justify-center transition-colors shadow-sm ${showGifPicker ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/30' : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        <StickyNote size={24} />
                     </button>
                    <button onClick={() => fileInputRef.current?.click()} className={`h-10 w-10 md:h-12 md:w-12 rounded-full flex items-center justify-center transition-colors shadow-sm ${selectedFile ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/30' : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                        <Image size={24} />
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handleImageSelect} />
                </div>

                <div className="flex-1 bg-white dark:bg-gray-900 rounded-[24px] shadow-sm border border-gray-200 dark:border-gray-800 flex items-end overflow-hidden min-h-[50px]">
                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onFocus={handleInputFocus}
                        rows={1}
                        placeholder={selectedFile ? "Ajouter une légende..." : "Écrivez votre message..."}
                        className="w-full bg-transparent border-none outline-none text-gray-800 dark:text-white px-4 py-3.5 placeholder-gray-400 resize-none max-h-[120px] overflow-y-auto leading-relaxed scrollbar-hide"
                        style={{ minHeight: '50px' }}
                    />
                </div>

                <MotionButton whileHover={{ scale: canSend ? 1.05 : 1 }} whileTap={{ scale: canSend ? 0.95 : 1 }} disabled={!canSend} onClick={handleSendMessage} className={`flex-shrink-0 mb-1 h-12 w-12 rounded-full flex items-center justify-center shadow-md transition-all duration-200 ${canSend ? 'bg-brand-500 text-white shadow-brand-500/30 hover:bg-brand-600' : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'}`}>
                    {isSending ? <Loader2 size={20} className="animate-spin text-white" /> : <Send size={20} className={`ml-0.5 ${canSend ? 'text-white' : 'text-gray-400'}`} />}
                </MotionButton>
            </div>
        </div>
    </div>
  );
};