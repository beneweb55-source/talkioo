import React from 'react';
import { Message } from '../../types';
import { CheckCheck } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn }) => {
  return (
    <div className={`flex w-full mb-3 ${isOwn ? 'justify-end' : 'justify-start'} group`}>
      <div
        className={`relative max-w-[75%] md:max-w-[60%] px-4 py-2 shadow-sm ${
          isOwn 
            ? 'bg-orange-500 text-white rounded-2xl rounded-tr-sm' 
            : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm'
        }`}
      >
        {!isOwn && (
          <div className="text-xs font-bold text-orange-600 mb-1 opacity-90">
            {message.sender_username}
          </div>
        )}
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
        </p>
        <div className={`flex items-center justify-end gap-1 mt-1 ${isOwn ? 'text-orange-100' : 'text-gray-400'}`}>
          <span className="text-[10px]">
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {isOwn && <CheckCheck size={14} className="opacity-80" />}
        </div>
      </div>
    </div>
  );
};