import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfileAPI, updatePasswordAPI, getBlockedUsersAPI, unblockUserAPI } from '../../services/api';
import { User } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X, Camera, Shield, UserX, Unlock, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface UserProfileProps {
  onClose: () => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const { user, login } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'blocked'>('profile');
  
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  
  const [selectedAvatar, setSelectedAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  
  const [blockedUsers, setBlockedUsers] = useState<User[]>([]);
  const [isBlockedLoading, setIsBlockedLoading] = useState(false);

  // Sync state if user updates from elsewhere (e.g. Socket in App.tsx)
  useEffect(() => {
    if (user) {
        setUsername(user.username);
        setEmail(user.email);
        // Only update preview if no file is currently selected by user
        if (!selectedAvatar) {
            setAvatarPreview(user.avatar_url || null);
        }
    }
  }, [user, selectedAvatar]);

  const fetchBlockedUsers = () => {
      setIsBlockedLoading(true);
      getBlockedUsersAPI()
        .then(setBlockedUsers)
        .catch(console.error)
        .finally(() => setIsBlockedLoading(false));
  };

  useEffect(() => {
      if (activeTab === 'blocked') {
          fetchBlockedUsers();
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
      const updatedUser = await updateProfileAPI({ 
          username, 
          email,
          avatar: selectedAvatar // Envoi du fichier si présent
      });
      
      // Update context if successful
      if (updatedUser) {
          const currentToken = localStorage.getItem('talkio_auth_token') || '';
          login(updatedUser, currentToken);
          // FORCE PREVIEW UPDATE to the real server URL to ensure we stop showing the blob
          setAvatarPreview(updatedUser.avatar_url || null);
      }
      setMessage({ text: "Profil mis à jour avec succès !", type: 'success' });
      setSelectedAvatar(null); // Reset selection
    } catch (err: any) {
      setMessage({ text: err.message || "Erreur lors de la mise à jour", type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    try {
      await updatePasswordAPI({ oldPassword, newPassword });
      setMessage({ text: "Mot de passe modifié !", type: 'success' });
      setOldPassword('');
      setNewPassword('');
    } catch (err: any) {
      setMessage({ text: err.message || "Erreur lors du changement de mot de passe", type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnblock = async (id: string) => {
      try {
          await unblockUserAPI(id);
          setBlockedUsers(prev => prev.filter(u => u.id !== id));
      } catch(e) { console.error(e); }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-800 relative">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
        <X size={20} />
      </button>
      
      <div className="flex flex-col items-center mb-6">
        <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <div className="h-24 w-24 bg-gradient-to-tr from-brand-400 to-brand-600 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-lg overflow-hidden border-4 border-white dark:border-gray-800">
                {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                    user?.username?.charAt(0).toUpperCase()
                )}
            </div>
            {/* Overlay Edit Icon */}
            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="text-white" size={24} />
            </div>
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handleAvatarChange}
            />
        </div>
        <h2 className="mt-3 text-xl font-bold dark:text-white">{user?.username}</h2>
        <span className="text-sm text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">#{user?.tag}</span>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-100 dark:border-gray-800 pb-1">
        <button 
            onClick={() => setActiveTab('profile')}
            className={`flex-1 pb-2 text-sm font-medium transition-colors relative ${activeTab === 'profile' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'}`}
        >
            Profil
            {activeTab === 'profile' && <MotionDiv layoutId="tab" className="absolute bottom-[-5px] left-0 right-0 h-0.5 bg-brand-500" />}
        </button>
        <button 
            onClick={() => setActiveTab('password')}
            className={`flex-1 pb-2 text-sm font-medium transition-colors relative ${activeTab === 'password' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'}`}
        >
            Sécurité
            {activeTab === 'password' && <MotionDiv layoutId="tab" className="absolute bottom-[-5px] left-0 right-0 h-0.5 bg-brand-500" />}
        </button>
        <button 
            onClick={() => setActiveTab('blocked')}
            className={`flex-1 pb-2 text-sm font-medium transition-colors relative ${activeTab === 'blocked' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'}`}
        >
            Bloqués
            {activeTab === 'blocked' && <MotionDiv layoutId="tab" className="absolute bottom-[-5px] left-0 right-0 h-0.5 bg-brand-500" />}
        </button>
      </div>

      <AnimatePresence>
      {message && (
        <MotionDiv initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mb-4 p-3 rounded-lg text-sm text-center ${message.type === 'success' ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
            {message.text}
        </MotionDiv>
      )}
      </AnimatePresence>

      {activeTab === 'profile' && (
        <form onSubmit={handleUpdateProfile} className="space-y-4">
            <Input label="Nom d'utilisateur" value={username} onChange={e => setUsername(e.target.value)} required />
            <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Button type="submit" isLoading={isLoading}>Enregistrer</Button>
        </form>
      )}

      {activeTab === 'password' && (
        <form onSubmit={handleUpdatePassword} className="space-y-4">
            <Input label="Ancien mot de passe" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required />
            <Input label="Nouveau mot de passe" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            <Button type="submit" isLoading={isLoading}>Changer le mot de passe</Button>
        </form>
      )}

      {activeTab === 'blocked' && (
          <div className="space-y-2">
              <div className="flex justify-between items-center mb-2 px-1">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Utilisateurs bloqués</span>
                  <button onClick={fetchBlockedUsers} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                      <RefreshCw size={12} className={isBlockedLoading ? 'animate-spin' : ''}/> Rafraîchir
                  </button>
              </div>
              
              {isBlockedLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="animate-spin text-brand-500" /></div>
              ) : blockedUsers.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">Aucun utilisateur bloqué.</p>
              ) : (
                  blockedUsers.map(blockedUser => (
                      <div key={blockedUser.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                          <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 overflow-hidden">
                                  {blockedUser.avatar_url ? (
                                      <img src={blockedUser.avatar_url} className="w-full h-full object-cover" alt={blockedUser.username || "User"} />
                                  ) : (
                                      (blockedUser.username || "U").charAt(0).toUpperCase()
                                  )}
                              </div>
                              <div className="flex flex-col">
                                  <span className="text-sm font-medium dark:text-gray-200">{blockedUser.username || "Utilisateur Inconnu"}</span>
                                  <span className="text-xs text-gray-400">#{blockedUser.tag || "????"}</span>
                              </div>
                          </div>
                          <button onClick={() => handleUnblock(blockedUser.id)} className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors" title="Débloquer">
                              <Unlock size={18} />
                          </button>
                      </div>
                  ))
              )}
          </div>
      )}
    </div>
  );
};