export interface User {
  id: number;
  username: string;
  email: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  name: string | null; // Null if private chat
  is_group: boolean;
  created_at: string;
  last_message?: string; // For UI display
  last_message_at?: string; // For UI display
}

export interface Participant {
  user_id: number;
  conversation_id: number;
  joined_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  sender_username?: string; // Joined for UI convenience
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface FriendRequest {
  id: number;
  sender_id: number;
  receiver_id: number;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  sender?: User; // Hydrated for UI
}