import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { updateProfileAPI, updatePasswordAPI } from '../../services/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { User, Lock, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';

interface UserProfileProps {
    onClose: () => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
    const { user, login, token } = useAuth();
    const [activeTab, setActiveTab] = useState<'info' | 'security'>('info');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Info State
    const [username, setUsername] = useState(user?.username || '');
    const [email, setEmail] = useState(user?.email || '');

    // Password State
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');

    const handleUpdateInfo = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);
        try {
            const updatedUser = await updateProfileAPI(username, email);
            if(token) login(updatedUser, token);
            setMessage({ type: 'success', text: 'Profil mis à jour avec succès !' });
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Erreur lors de la mise à jour' });
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);
        try {
            await updatePasswordAPI(currentPassword, newPassword);
            setMessage({ type: 'success', text: 'Mot de passe modifié !' });
            setCurrentPassword('');
            setNewPassword('');
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message || 'Erreur mot de passe' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] border border-gray-100 dark:border-gray-700 animate-in fade-in zoom-in duration-200">
                
                {/* Header */}
                <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-orange-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm">
                            {user?.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-800 dark:text-white text-lg">Mon Profil</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">#{user?.tag}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 dark:border-gray-700">
                    <button 
                        onClick={() => { setActiveTab('info'); setMessage(null); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'info' ? 'text-orange-600 border-b-2 border-orange-600 bg-orange-50 dark:bg-orange-900/20' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    >
                        <User size={16} /> Informations
                    </button>
                    <button 
                        onClick={() => { setActiveTab('security'); setMessage(null); }}
                        className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'security' ? 'text-orange-600 border-b-2 border-orange-600 bg-orange-50 dark:bg-orange-900/20' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                    >
                        <Lock size={16} /> Sécurité
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    {message && (
                        <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                            {message.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                            {message.text}
                        </div>
                    )}

                    {activeTab === 'info' ? (
                        <form onSubmit={handleUpdateInfo} className="space-y-4">
                            <Input 
                                label="Nom d'utilisateur" 
                                value={username} 
                                onChange={(e) => setUsername(e.target.value)} 
                                placeholder="Votre pseudo"
                            />
                            <Input 
                                label="Email" 
                                type="email" 
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                placeholder="email@exemple.com"
                            />
                            <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded text-xs text-gray-500 dark:text-gray-400">
                                Note: Votre Tag <b>#{user?.tag}</b> est unique et ne peut pas être modifié.
                            </div>
                            <div className="pt-2">
                                <Button type="submit" isLoading={loading} className="flex items-center justify-center gap-2">
                                    <Save size={18} /> Enregistrer
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleUpdatePassword} className="space-y-4">
                            <Input 
                                label="Mot de passe actuel" 
                                type="password" 
                                value={currentPassword} 
                                onChange={(e) => setCurrentPassword(e.target.value)} 
                                required
                            />
                            <Input 
                                label="Nouveau mot de passe" 
                                type="password" 
                                value={newPassword} 
                                onChange={(e) => setNewPassword(e.target.value)} 
                                required
                            />
                            <div className="pt-2">
                                <Button type="submit" isLoading={loading} className="flex items-center justify-center gap-2">
                                    <Save size={18} /> Changer le mot de passe
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};