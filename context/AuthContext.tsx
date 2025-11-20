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
          try {
              const { data: { session } } = await supabase.auth.getSession();
              
              if (session?.user) {
                  // Récupérer le profil utilisateur complet (avec username/tag)
                  const userData = await getUserByIdAPI(session.user.id);
                  if (userData) {
                      setUser(userData);
                      setToken(session.access_token);
                  }
              }
          } catch (e) {
              console.error("Erreur de session Supabase:", e);
          } finally {
              setIsLoading(false);
          }
      };

      checkSession();

      // Écouter les changements d'état (ex: déconnexion depuis un autre onglet)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
          if (!session) {
              setUser(null);
              setToken(null);
              setIsLoading(false);
          }
      });

      return () => subscription.unsubscribe();
  }, []);

  const login = (userData: User, authToken: string) => {
    setUser(userData);
    setToken(authToken);
  };

  const logout = async () => {
    await supabase.auth.signOut();
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