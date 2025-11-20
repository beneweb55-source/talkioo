import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { getUserByIdAPI } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';

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
      const checkSession = async () => {
          if (!supabase) {
              setIsLoading(false);
              return;
          }

          const { data: { session } } = await supabase.auth.getSession();

          if (session?.user) {
              try {
                  const userData = await getUserByIdAPI(session.user.id);
                  if (userData) {
                      setUser(userData);
                      setToken(session.access_token);
                  }
              } catch (e) {
                  console.error("Session load error", e);
                  await supabase.auth.signOut();
              }
          }
          setIsLoading(false);
      };

      checkSession();
  }, []);

  const login = (userData: User, authToken: string) => {
    setUser(userData);
    setToken(authToken);
  };

  const logout = async () => {
    if(supabase) await supabase.auth.signOut();
    setUser(null);
    setToken(null);
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