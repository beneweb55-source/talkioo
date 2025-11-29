
export interface User {
  id: string; // UUID
  username: string;
  tag: string; // ex: 1234
  email: string;
  created_at: string;
  avatar_url?: string | null; // URL de la photo de profil
}

export interface GroupMember {
  id: string; // User ID
  username: string;
  tag: string;
  avatar_url?: string | null;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface Conversation {
  id: string;
  name: string | null;
  is_group: boolean;
  created_at: string;
  avatar_url?: string | null; // New field for group avatar
  last_message?: string;
  last_message_at?: string;
}

export interface Participant {
  user_id: string;
  conversation_id: string;
  joined_at: string;
  role?: 'admin' | 'member'; // New field
  last_deleted_at?: string | null; // For Soft Delete logic
}

export interface Reaction {
  emoji: string;
  user_id: string;
  username?: string; // New: For displaying who reacted
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
  sender_avatar?: string;
  read_count?: number;
  message_type?: 'text' | 'image' | 'video' | 'audio' | 'gif' | 'sticker';
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

export interface Sticker {
  id: string;
  url: string;
  user_id: string | null;
}

export interface AuthResponse {
  user: User;
  token: string;
}