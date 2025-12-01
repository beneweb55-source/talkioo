import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfileAPI, updatePasswordAPI, getBlockedUsersAPI, unblockUserAPI } from '../../services/api';
import { User } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X, Camera, Palette, Unlock, Loader2, Check, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface UserProfileProps {
  onClose: () => void;
}

// Convert HSL to Hex for the color wheel
const hslToHex = (h: number, s: number, l: number) => {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const PRIMARY_PRESETS = [
    { color: '#f97316', name: 'Orange' },
    { color: '#3b82f6', name: 'Bleu' },
    { color: '#8b5cf6', name: 'Violet' },
    { color: '#ec4899', name: 'Rose' },
    { color: '#22c55e', name: 'Vert' },
];

export const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const { user, login, applyTheme } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'profile' | 'appearance' | 'settings' | 'blocked'>('profile');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [themeColor, setThemeColor] = useState(user?.theme_color || '#f97316');
  
  // Custom Color Wheel State
  const [showColorWheel, setShowColorWheel] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);
  const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 }); // Visual position of the selector thumb
  
  const [selectedAvatar, setSelectedAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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

  // --- COLOR WHEEL LOGIC ---
  const handleColorInteraction = (clientX: number, clientY: number) => {
      if (!wheelRef.current) return;
      const rect = wheelRef.current.getBoundingClientRect();
      const radius = rect.width / 2;
      const centerX = rect.left + radius;
      const centerY = rect.top + radius;
      
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      
      // Angle (Hue)
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      
      // Distance (Saturation)
      const distance = Math.min(Math.sqrt(dx * dx + dy * dy), radius);
      const saturation = (distance / radius) * 100;
      
      // Update Thumb Visual Position (Constrained to circle)
      const moveX = Math.cos(angle * (Math.PI / 180)) * distance;
      const moveY = Math.sin(angle * (Math.PI / 180)) * distance;
      setThumbPos({ x: moveX, y: moveY });

      // Generate Color (Lightness fixed at 50% for vivid colors)
      const hex = hslToHex(angle, saturation, 50);
      setThemeColor(hex);
      applyTheme(hex);
  };

  const onWheelMove = (e: React.TouchEvent | React.MouseEvent) => {
      let clientX, clientY;
      if ('touches' in e) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
      } else {
          if ((e as React.MouseEvent).buttons !== 1) return;
          clientX = (e as React.MouseEvent).clientX;
          clientY = (e as React.MouseEvent).clientY;
      }
      handleColorInteraction(clientX, clientY);
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
                  
                  {/* Primary Presets */}
                  <div className="flex flex-wrap justify-center gap-4 mb-4">
                      {PRIMARY_PRESETS.map(preset => (
                          <button 
                            key={preset.color} 
                            onClick={() => { setThemeColor(preset.color); applyTheme(preset.color); setShowColorWheel(false); }}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 relative shadow-sm ${themeColor === preset.color && !showColorWheel ? 'scale-110 ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-gray-900' : 'hover:scale-105'}`}
                            style={{ backgroundColor: preset.color }}
                            title={preset.name}
                          >
                              {themeColor === preset.color && !showColorWheel && <Check size={20} className="text-white drop-shadow-md" strokeWidth={3} />}
                          </button>
                      ))}

                      {/* Toggle Color Wheel (Rainbow Button) */}
                      <button 
                        onClick={() => setShowColorWheel(!showColorWheel)}
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 relative shadow-sm bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 ${showColorWheel ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900' : 'hover:scale-105'}`}
                        title="Couleur personnalisée"
                      >
                          {showColorWheel ? <ChevronUp size={20} className="text-white" /> : <ChevronDown size={20} className="text-white" />}
                      </button>
                  </div>

                  {/* Circular Color Wheel Panel */}
                  <AnimatePresence>
                    {showColorWheel && (
                        <MotionDiv 
                            initial={{ opacity: 0, height: 0, scale: 0.9 }}
                            animate={{ opacity: 1, height: 'auto', scale: 1 }}
                            exit={{ opacity: 0, height: 0, scale: 0.9 }}
                            className="w-full flex justify-center overflow-hidden mb-2"
                        >
                            <div 
                                ref={wheelRef}
                                className="relative w-56 h-56 rounded-full shadow-inner ring-4 ring-white dark:ring-gray-800 cursor-crosshair touch-none select-none"
                                style={{
                                    background: `
                                        radial-gradient(closest-side, gray, transparent),
                                        conic-gradient(red, yellow, lime, aqua, blue, magenta, red)
                                    `
                                }}
                                onMouseDown={(e) => handleColorInteraction(e.clientX, e.clientY)}
                                onMouseMove={onWheelMove}
                                onTouchStart={(e) => handleColorInteraction(e.touches[0].clientX, e.touches[0].clientY)}
                                onTouchMove={onWheelMove}
                            >
                                {/* Center "Thumb" indicator */}
                                <div 
                                    className="absolute w-6 h-6 rounded-full border-2 border-white shadow-md pointer-events-none transform -translate-x-1/2 -translate-y-1/2 transition-transform duration-75 ease-out"
                                    style={{ 
                                        backgroundColor: themeColor,
                                        left: '50%',
                                        top: '50%',
                                        transform: `translate(calc(-50% + ${thumbPos.x}px), calc(-50% + ${thumbPos.y}px))`
                                    }}
                                ></div>
                            </div>
                        </MotionDiv>
                    )}
                  </AnimatePresence>
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
