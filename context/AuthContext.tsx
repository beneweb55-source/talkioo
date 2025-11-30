import React, { createContext, useContext, useState, useEffect, ReactNode, PropsWithChildren } from 'react';
import { User } from '../types';
import { getUserByIdAPI, connectSocket, disconnectSocket } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
  isLoading: boolean;
  applyTheme: (color: string) => void; // Exposed for real-time preview
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// RGB Values for Tailwind Themes (Presets)
const PRESETS: Record<string, Record<number, string>> = {
    orange: {
        50: '255 247 237', 100: '255 237 213', 200: '254 215 170', 300: '253 186 116',
        400: '251 146 60', 500: '249 115 22', 600: '234 88 12', 700: '194 65 12', 800: '154 52 18', 900: '124 45 18'
    },
    blue: {
        50: '239 246 255', 100: '219 234 254', 200: '191 219 254', 300: '147 197 253',
        400: '96 165 250', 500: '59 130 246', 600: '37 99 235', 700: '29 78 216', 800: '30 64 175', 900: '30 58 138'
    },
    purple: {
        50: '250 245 255', 100: '243 232 255', 200: '233 213 255', 300: '216 180 254',
        400: '192 132 252', 500: '168 85 247', 600: '147 51 234', 700: '126 34 206', 800: '107 33 168', 900: '88 28 135'
    },
    pink: {
        50: '253 242 248', 100: '252 231 243', 200: '251 207 232', 300: '249 168 212',
        400: '244 114 182', 500: '236 72 153', 600: '219 39 119', 700: '190 24 93', 800: '157 23 77', 900: '131 24 67'
    },
    green: {
        50: '240 253 244', 100: '220 252 231', 200: '187 247 208', 300: '134 239 172',
        400: '74 222 128', 500: '34 197 94', 600: '22 163 74', 700: '21 128 61', 800: '22 101 52', 900: '20 83 45'
    },
    red: {
        50: '254 242 242', 100: '254 226 226', 200: '254 202 202', 300: '252 165 165',
        400: '248 113 113', 500: '239 68 68', 600: '220 38 38', 700: '185 28 28', 800: '153 27 27', 900: '127 29 29'
    }
};

// Helper to convert Hex to RGB string "r g b"
const hexToRgbString = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return '0 0 0';
    return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
};

// Mix two colors to create shades (Simple mixing implementation)
const mixColors = (color1: string, color2: string, weight: number) => {
    const c1 = hexToRgbString(color1).split(' ').map(Number);
    const c2 = hexToRgbString(color2).split(' ').map(Number);
    
    const r = Math.round(c1[0] * weight + c2[0] * (1 - weight));
    const g = Math.round(c1[1] * weight + c2[1] * (1 - weight));
    const b = Math.round(c1[2] * weight + c2[2] * (1 - weight));
    
    return `${r} ${g} ${b}`;
};

// Generate a full palette from a single color
const generatePalette = (baseColor: string) => {
    // If it's a known preset key, return the preset
    if (PRESETS[baseColor]) return PRESETS[baseColor];

    // Otherwise generate from Hex
    return {
        50: mixColors('#ffffff', baseColor, 0.95),
        100: mixColors('#ffffff', baseColor, 0.9),
        200: mixColors('#ffffff', baseColor, 0.8),
        300: mixColors('#ffffff', baseColor, 0.6),
        400: mixColors('#ffffff', baseColor, 0.4),
        500: hexToRgbString(baseColor), // Base
        600: mixColors('#000000', baseColor, 0.1),
        700: mixColors('#000000', baseColor, 0.2),
        800: mixColors('#000000', baseColor, 0.3),
        900: mixColors('#000000', baseColor, 0.4),
    };
};

const applyThemeInternal = (colorInput: string) => {
    const palette = generatePalette(colorInput);
    const root = document.documentElement;
    Object.entries(palette).forEach(([shade, rgbValue]) => {
        root.style.setProperty(`--brand-${shade}`, rgbValue);
    });
};

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
                      connectSocket(storedToken, foundUser.id);
                      applyThemeInternal(foundUser.theme_color || 'orange');
                  } else {
                      throw new Error("User not found");
                  }
              } catch (e) {
                  console.error("Session restoration failed", e);
                  localStorage.removeItem('talkio_current_user_id');
                  localStorage.removeItem('talkio_auth_token');
                  applyThemeInternal('orange');
              }
          } else {
              applyThemeInternal('orange');
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
    applyThemeInternal(userData.theme_color || 'orange');
  };

  const logout = () => {
    localStorage.removeItem('talkio_current_user_id');
    localStorage.removeItem('talkio_auth_token');
    setUser(null);
    setToken(null);
    disconnectSocket();
    applyThemeInternal('orange'); 
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading, applyTheme: applyThemeInternal }}>
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