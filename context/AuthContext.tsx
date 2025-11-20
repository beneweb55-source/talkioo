import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { getUserByIdAPI } from '../services/mockBackend';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
      const restoreSession = async () => {
          const storedToken = localStorage.getItem('talkio_token');
          const storedUserId = localStorage.getItem('talkio_user_id');

          if (storedToken && storedUserId) {
              try {
                  const userData = await getUserByIdAPI(parseInt(storedUserId));
                  if (userData) {
                      setUser(userData);
                      setToken(storedToken);
                  } else {
                      // Invalid stored data
                      logout();
                  }
              } catch (e) {
                  logout();
              }
          }
          setIsLoading(false);
      };

      restoreSession();
  }, []);

  const login = (userData: User, authToken: string) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('talkio_token', authToken);
    localStorage.setItem('talkio_user_id', userData.id.toString());
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('talkio_token');
    localStorage.removeItem('talkio_user_id');
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