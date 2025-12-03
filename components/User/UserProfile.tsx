import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfileAPI, updatePasswordAPI, getBlockedUsersAPI, unblockUserAPI } from '../../services/api';
import { User } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X, Camera, Palette, Unlock, Loader2, Check, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface UserProfileProps {
  onClose: () => void;
}

// Les classiques (Top 5)
const PRIMARY_PRESETS = [
    { color: '#f97316', name: 'Orange' },
    { color: '#3b82f6', name: 'Bleu' },
    { color: '#8b5cf6', name: 'Violet' },
    { color: '#ec4899', name: 'Rose' },
    { color: '#22c55e', name: 'Vert' },
];

// Helper pour HSL -> Hex
function hslToHex(h: number, s: number, l: number) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const { user, login, applyTheme } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'profile' | 'appearance' | 'settings' | 'blocked'>('profile');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [themeColor, setThemeColor] = useState(user?.theme_color || '#f97316');
  
  const [selectedAvatar, setSelectedAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spectrumRef = useRef<HTMLDivElement>(null);
  
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  const [isBlockedLoading, setIsBlockedLoading] = useState(false);

  useEffect(() => {
    if (user) {
        setUsername(user.username);
        setEmail(user.email);
        if (!selectedAvatar) setAvatarPreview(user.avatar_url || null);
        if (user.theme_color) setThemeColor(user.theme_color);
    }
  }, [user]);

  useEffect(() => {
      if (activeTab === 'blocked') {
          setIsBlockedLoading(true);
          getBlockedUsersAPI().then(setBlockedUsers).finally(() => setIsBlockedLoading(false));
      }
  }, [activeTab]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          setSelectedAvatar(file);
          setAvatarPreview(URL.createObjectURL(file));
      }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      const updatedUser = await updateProfileAPI({ username, email, avatar: selectedAvatar });
      if (updatedUser) login(updatedUser, localStorage.getItem('talkio_auth_token') || '');
      setMessage({ text: "Profil mis à jour !", type: 'success' });
    } catch (err: any) { setMessage({ text: err.message, type: 'error' }); } finally { setIsLoading(false); }
  };

  const handleSpectrumInteraction = (e: React.MouseEvent | React.TouchEvent) => {
      if (!spectrumRef.current) return;
      const rect = spectrumRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      let x = clientX - rect.left;
      x = Math.max(0, Math.min(x, rect.width));
      const hue = Math.floor((x / rect.width) * 360);
      const color = hslToHex(hue, 100, 50);
      setThemeColor(color);
      applyTheme(color);
  };

  const handleSaveTheme = async () => {
      setIsLoading(true);
      try {
          const updatedUser = await updateProfileAPI({ theme_color: themeColor });
          if(updatedUser) login(updatedUser, localStorage.getItem('talkio_auth_token') || '');
          setMessage({ text: "Thème sauvegardé !", type: 'success' });
      } catch(err: any) { setMessage({ text: err.message, type: 'error' }); }
      finally { setIsLoading(false); }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await updatePasswordAPI({ oldPassword, newPassword });
      setMessage({ text: "Mot de passe modifié !", type: 'success' });
      setOldPassword(''); setNewPassword('');
    } catch (err: any) { setMessage({ text: err.message, type: 'error' }); } finally { setIsLoading(false); }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-800 relative">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20} /></button>
      
      <div className="flex flex-col items-center mb-4">
        <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <div className="h-20 w-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg overflow-hidden border-4 border-white dark:border-gray-800 transition-colors duration-300" style={{ backgroundColor: themeColor }}>
                {avatarPreview ? <img src={avatarPreview} className="w-full h-full object-cover" /> : user?.username?.charAt(0).toUpperCase()}
            </div>
            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Camera className="text-white" size={20} /></div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
        </div>
        <h2 className="mt-2 text-lg font-bold dark:text-white">{user?.username}</h2>
      </div>

      <div className="flex overflow-x-auto gap-4 mb-6 border-b border-gray-100 dark:border-gray-800 pb-1 no-scrollbar">
        {['profile', 'appearance', 'settings', 'blocked'].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab as any)} className={`pb-2 text-sm font-medium transition-colors relative whitespace-nowrap ${activeTab === tab ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'}`}>
                {tab === 'profile' && 'Profil'}
                {tab === 'appearance' && 'Apparence'}
                {tab === 'settings' && 'Sécurité'}
                {tab === 'blocked' && 'Bloqués'}
                {activeTab === tab && <MotionDiv layoutId="tab" className="absolute bottom-[-5px] left-0 right-0 h-0.5 bg-brand-500" />}
            </button>
        ))}
      </div>

      <AnimatePresence>
      {message && <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`mb-4 p-3 rounded-lg text-sm text-center ${message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{message.text}</MotionDiv>}
      </AnimatePresence>

      {activeTab === 'profile' && (
        <form onSubmit={handleUpdateProfile} className="space-y-4">
            <Input label="Nom d'utilisateur" value={username} onChange={e => setUsername(e.target.value)} required />
            <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Button type="submit" isLoading={isLoading}>Enregistrer</Button>
        </form>
      )}

      {activeTab === 'appearance' && (
          <div className="space-y-6">
              <div className="flex flex-col items-center">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-5">Choisissez votre couleur</h3>
                  
                  {/* Primary Presets Grid */}
                  <div className="flex flex-wrap justify-center gap-4 mb-6">
                      {PRIMARY_PRESETS.map(preset => (
                          <button 
                            key={preset.color} 
                            onClick={() => { setThemeColor(preset.color); applyTheme(preset.color); }}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 relative shadow-sm ${themeColor === preset.color ? 'scale-110 ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-gray-900' : 'hover:scale-105'}`}
                            style={{ backgroundColor: preset.color }}
                            title={preset.name}
                          >
                              {themeColor === preset.color && <Check size={20} className="text-white drop-shadow-md" strokeWidth={3} />}
                          </button>
                      ))}
                  </div>

                  {/* Rectangular Spectrum Palette */}
                  <div className="w-full mb-4">
                      <p className="text-xs text-center text-gray-500 mb-2 font-medium uppercase tracking-wider">Personnaliser</p>
                      <div 
                        ref={spectrumRef}
                        className="h-12 w-full rounded-xl cursor-crosshair shadow-inner relative overflow-hidden"
                        style={{ 
                            background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
                        }}
                        onMouseDown={handleSpectrumInteraction}
                        onMouseMove={(e) => e.buttons === 1 && handleSpectrumInteraction(e)}
                        onTouchStart={handleSpectrumInteraction}
                        onTouchMove={handleSpectrumInteraction}
                      >
                          {/* Optional Indicator for selected color if needed, but the live preview is better */}
                      </div>
                  </div>
              </div>

              {/* Live Preview Card */}
              <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700/50 select-none">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="h-10 w-10 rounded-full bg-brand-500 flex items-center justify-center text-white shadow-lg shadow-brand-500/30 transition-colors duration-300">
                          <MessageCircle size={20} />
                      </div>
                      <div className="space-y-1.5 flex-1">
                          <div className="h-2 w-24 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                          <div className="h-2 w-16 bg-gray-100 dark:bg-gray-800 rounded-full"></div>
                      </div>
                  </div>
                  <div className="flex justify-end">
                      <div className="bg-brand-500 text-white px-4 py-2 rounded-2xl rounded-tr-sm text-sm font-medium shadow-md shadow-brand-500/20 transition-colors duration-300">
                          Aperçu du style ✨
                      </div>
                  </div>
              </div>

              <Button onClick={handleSaveTheme} isLoading={isLoading} className="w-full py-3 rounded-xl font-bold shadow-lg shadow-brand-500/20">
                  Valider ce thème
              </Button>
          </div>
      )}

      {activeTab === 'settings' && (
        <form onSubmit={handleUpdatePassword} className="space-y-4">
            <Input label="Ancien mot de passe" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required />
            <Input label="Nouveau mot de passe" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            <Button type="submit" isLoading={isLoading}>Changer le mot de passe</Button>
        </form>
      )}

      {activeTab === 'blocked' && (
          <div className="space-y-2">
              {isBlockedLoading ? <div className="flex justify-center py-4"><Loader2 className="animate-spin text-brand-500" /></div> : blockedUsers.length === 0 ? <p className="text-center text-gray-400 text-sm py-4">Aucun utilisateur bloqué.</p> : blockedUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                      <span className="text-sm font-medium dark:text-gray-200">{u.username}</span>
                      <button onClick={() => { unblockUserAPI(u.id).then(() => setBlockedUsers(p => p.filter(x => x.id !== u.id))); }} className="p-2 text-gray-400 hover:text-green-600 bg-gray-100 dark:bg-gray-700 rounded-lg"><Unlock size={16}/></button>
                  </div>
              ))}
          </div>
      )}
    </div>
  );
};