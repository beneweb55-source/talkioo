export interface User {
  id: string; // UUID
  username: string;
  tag: string; // ex: 1234
  email: string;
  created_at: string;
}

export interface GroupMember {
  id: string;
  user_id: string;
  conversation_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  user?: User;
}

export interface Conversation {
  id: string;
  name: string | null;
  is_group: boolean;
  created_at: string;
  last_message?: string;
  last_message_at?: string;
}

export interface Participant {
  user_id: string;
  conversation_id: string;
  joined_at: string;
  last_deleted_at?: string | null; // For Soft Delete logic
}

export interface Reaction {
  emoji: string;
  user_id: string;
  count?: number; // Calculé côté front
  user_reacted?: boolean; // Calculé côté front
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  updated_at?: string; // New: For edit history
  deleted_at?: string; // New: For soft delete (delete for everyone)
  sender_username?: string;
  read_count?: number;
  message_type?: 'text' | 'image' | 'video' | 'audio';
  attachment_url?: string;
  image_url?: string; // Fallback for backward compatibility
  reactions?: Reaction[]; // New: List of reactions
  reply?: {
    id: string;
    content: string;
    sender: string;
    message_type?: string;
    attachment_url?: string;
  } | null;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  sender?: User;
}

export interface AuthResponse {
  user: User;
  token: string;
}