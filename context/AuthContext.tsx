import React, { createContext, useContext, useState, useEffect, ReactNode, PropsWithChildren } from 'react';
import { User } from '../types';
import { getUserByIdAPI, connectSocket, disconnectSocket } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: PropsWithChildren<{}>) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
      const initSession = async () => {
          const storedUserId = localStorage.getItem('talkio_current_user_id');
          const storedToken = localStorage.getItem('talkio_auth_token');
          
          if (storedUserId && storedToken) {
              try {
                  const foundUser = await getUserByIdAPI(storedUserId);
                  if (foundUser) {
                      setUser(foundUser);
                      setToken(storedToken);
                      // Reconnect Socket
                      connectSocket(storedToken);
                  } else {
                      throw new Error("User not found");
                  }
              } catch (e) {
                  console.error("Session restoration failed", e);
                  localStorage.removeItem('talkio_current_user_id');
                  localStorage.removeItem('talkio_auth_token');
              }
          }
          setIsLoading(false);
      };
      initSession();
  }, []);

  const login = (userData: User, authToken: string) => {
    localStorage.setItem('talkio_current_user_id', userData.id);
    localStorage.setItem('talkio_auth_token', authToken);
    setUser(userData);
    setToken(authToken);
    connectSocket(authToken);
  };

  const logout = () => {
    localStorage.removeItem('talkio_current_user_id');
    localStorage.removeItem('talkio_auth_token');
    setUser(null);
    setToken(null);
    disconnectSocket();
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};