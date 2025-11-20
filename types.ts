export interface User {
  id: string; // UUID
  username: string;
  tag: string; // ex: 1234
  email: string;
  created_at: string;
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
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender_username?: string;
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