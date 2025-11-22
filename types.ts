export interface User {
  id: string; // UUID
  username: string;
  tag: string; // ex: 1234
  email: string;
  created_at: string;
  is_online?: boolean;
}

export interface Conversation {
  id: string;
  name: string | null;
  is_group: boolean;
  created_at: string;
  last_message?: string;
  last_message_at?: string;
  group_id?: string; // Lien vers la table groups
  my_role?: 'owner' | 'admin' | 'member'; // Rôle de l'utilisateur courant
}

export interface Participant {
  user_id: string;
  conversation_id: string;
  joined_at: string;
  last_deleted_at?: string | null; // For Soft Delete logic
}

export interface GroupMember {
  user_id: string;
  username: string;
  tag: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  is_online?: boolean;
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
  reply?: {
    id: string;
    content: string;
    sender: string;
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