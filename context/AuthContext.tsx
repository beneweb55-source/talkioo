
import React, { createContext, useContext, useState, useEffect, PropsWithChildren } from 'react';
import { User } from '../types';
import { getUserByIdAPI, connectSocket, disconnectSocket } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  isLoading: boolean;
  applyTheme: (hexColor: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper: Convert Hex to RGB
function hexToRgb(hex: string) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// Helper: Lighten/Darken color for palette generation
function adjustColor(hex: string, percent: number) {
    const { r, g, b } = hexToRgb(hex);
    const amt = Math.round(2.55 * percent);
    const R = (r + amt < 0) ? 0 : (r + amt > 255) ? 255 : r + amt;
    const G = (g + amt < 0) ? 0 : (g + amt > 255) ? 255 : g + amt;
    const B = (b + amt < 0) ? 0 : (b + amt > 255) ? 255 : b + amt;
    return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
}

export const AuthProvider = ({ children }: PropsWithChildren<{}>) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Apply Theme Logic
  const applyTheme = (color: string) => {
      const root = document.documentElement;
      
      // Update CSS Variables for Tailwind
      root.style.setProperty('--brand-50', adjustColor(color, 180));
      root.style.setProperty('--brand-100', adjustColor(color, 150));
      root.style.setProperty('--brand-200', adjustColor(color, 100));
      root.style.setProperty('--brand-300', adjustColor(color, 60));
      root.style.setProperty('--brand-400', adjustColor(color, 30));
      root.style.setProperty('--brand-500', color); // Base
      root.style.setProperty('--brand-600', adjustColor(color, -20));
      root.style.setProperty('--brand-700', adjustColor(color, -40));
      root.style.setProperty('--brand-800', adjustColor(color, -60));
      root.style.setProperty('--brand-900', adjustColor(color, -80));

      // Update Mobile Browser Address Bar Color
      let metaThemeColor = document.querySelector("meta[name='theme-color']");
      if (!metaThemeColor) {
          metaThemeColor = document.createElement('meta');
          metaThemeColor.setAttribute('name', 'theme-color');
          document.head.appendChild(metaThemeColor);
      }
      metaThemeColor.setAttribute('content', color);
  };

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
                      connectSocket(storedToken, foundUser.id);
                      if (foundUser.theme_color) applyTheme(foundUser.theme_color);
                  } else {
                      throw new Error("User not found");
                  }
              } catch (e) {
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
    connectSocket(authToken, userData.id);
    if (userData.theme_color) applyTheme(userData.theme_color);
  };

  const logout = () => {
    localStorage.removeItem('talkio_current_user_id');
    localStorage.removeItem('talkio_auth_token');
    setUser(null);
    setToken(null);
    disconnectSocket();
    applyTheme('#f97316'); // Reset to default
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading, applyTheme }}>
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