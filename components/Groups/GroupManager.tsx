import React, { useState, useEffect, useRef } from 'react';
import { Conversation, User, GroupMember } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { updateGroup, addMembers, removeMember, leaveGroup, getGroupMembers } from '../../services/api';
import { Users, UserPlus, Trash2, LogOut, Settings, Camera, Crown, ShieldAlert, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface GroupManagerProps {
  conversation: Conversation;
  currentUser: User;
  onClose: () => void;
  onUpdate: () => void;
  contacts: User[];
}

export const GroupManager: React.FC<GroupManagerProps> = ({ 
  conversation, 
  currentUser, 
  onClose, 
  onUpdate,
  contacts 
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'members'>('info');
  const [name, setName] = useState(conversation.name || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(conversation.avatar_url || null);
  const [selectedAvatar, setSelectedAvatar] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isAddMode, setIsAddMode] = useState(false);

  // Fetch members on mount
  useEffect(() => {
    const fetchMembers = async () => {
        try {
            const data = await getGroupMembers(conversation.id);
            setMembers(data);
        } catch (e) { console.error(e); }
    };
    fetchMembers();
  }, [conversation.id]);

  const isAdmin = members.find(m => m.id === currentUser.id)?.role === 'admin';

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          setSelectedAvatar(file);
          setAvatarPreview(URL.createObjectURL(file));
      }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await updateGroup(conversation.id, { name, avatar: selectedAvatar });
      onUpdate();
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMembers = async () => {
    if (selectedContacts.length === 0) return;
    setIsLoading(true);
    try {
      await addMembers(conversation.id, selectedContacts);
      setSelectedContacts([]);
      setIsAddMode(false);
      onUpdate();
      const updatedMembers = await getGroupMembers(conversation.id);
      setMembers(updatedMembers);
    } catch (error) { console.error(error); } finally { setIsLoading(false); }
  };

  const handleKickMember = async (userId: string) => {
      if(!window.confirm("Exclure ce membre ?")) return;
      try {
          await removeMember(conversation.id, userId);
          setMembers(prev => prev.filter(m => m.id !== userId));
      } catch (e) { console.error(e); }
  };

  const handleLeaveGroup = async () => {
    if (!window.confirm("Voulez-vous vraiment quitter ce groupe ?")) return;
    try {
      await leaveGroup(conversation.id);
      onClose(); 
    } catch (error) { console.error(error); }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-800 relative">
      <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
        <X size={20}/>
      </button>
      
      <div className="flex items-center gap-2 mb-6">
        <Settings className="text-brand-500" /> 
        <h2 className="text-xl font-bold dark:text-white">Gestion du Groupe</h2>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-100 dark:border-gray-800 pb-1">
        <button onClick={() => setActiveTab('info')} className={`flex-1 pb-2 text-sm font-medium transition-colors relative ${activeTab === 'info' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'}`}>
            Informations
            {activeTab === 'info' && <MotionDiv layoutId="tab-group" className="absolute bottom-[-5px] left-0 right-0 h-0.5 bg-brand-500" />}
        </button>
        <button onClick={() => setActiveTab('members')} className={`flex-1 pb-2 text-sm font-medium transition-colors relative ${activeTab === 'members' ? 'text-brand-600 dark:text-brand-400' : 'text-gray-500'}`}>
            Membres ({members.length})
            {activeTab === 'members' && <MotionDiv layoutId="tab-group" className="absolute bottom-[-5px] left-0 right-0 h-0.5 bg-brand-500" />}
        </button>
      </div>

      {activeTab === 'info' ? (
        <form onSubmit={handleUpdateGroup} className="space-y-6">
            <div className="flex flex-col items-center">
                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <div className="h-24 w-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center overflow-hidden border-4 border-white dark:border-gray-800 shadow-lg">
                        {avatarPreview ? (
                            <img src={avatarPreview} alt="Group" className="w-full h-full object-cover" />
                        ) : (
                            <Users size={32} className="text-gray-400" />
                        )}
                    </div>
                    <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera className="text-white" size={24} />
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarChange} />
                </div>
            </div>

            <Input label="Nom du groupe" value={name} onChange={(e) => setName(e.target.value)} />
            
            <Button type="submit" isLoading={isLoading} disabled={name === conversation.name && !selectedAvatar}>
              Enregistrer les modifications
            </Button>
            
            <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                <Button type="button" variant="danger" onClick={handleLeaveGroup} className="w-full flex items-center justify-center gap-2">
                    <LogOut size={16} /> Quitter le groupe
                </Button>
            </div>
        </form>
      ) : (
        <div className="space-y-4">
             <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Liste des participants</h3>
                <button onClick={() => setIsAddMode(!isAddMode)} className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium">
                    <UserPlus size={14} /> {isAddMode ? 'Annuler' : 'Ajouter'}
                </button>
            </div>

            <AnimatePresence>
                {isAddMode && (
                    <MotionDiv initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mb-4 overflow-hidden">
                        <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-xl max-h-40 overflow-y-auto border border-gray-100 dark:border-gray-700">
                            {contacts.filter(c => !members.find(m => m.id === c.id)).length === 0 && <p className="text-xs text-gray-400 text-center">Aucun contact à ajouter.</p>}
                            {contacts.filter(c => !members.find(m => m.id === c.id)).map(contact => (
                                <div key={contact.id} onClick={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(c => c !== contact.id) : [...prev, contact.id])} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm mb-1 ${selectedContacts.includes(contact.id) ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300'}`}>
                                    <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedContacts.includes(contact.id) ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-400'}`}>
                                        {selectedContacts.includes(contact.id) && <Check size={12} />}
                                    </div>
                                    {contact.username}
                                </div>
                            ))}
                        </div>
                        <Button onClick={handleAddMembers} isLoading={isLoading} className="mt-2 text-xs py-1.5" disabled={selectedContacts.length === 0}>Confirmer</Button>
                    </MotionDiv>
                )}
            </AnimatePresence>

            <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {members.map(member => (
                    <div key={member.id} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center overflow-hidden font-bold text-gray-500">
                                {member.avatar_url ? <img src={member.avatar_url} className="w-full h-full object-cover" alt={member.username} /> : member.username[0].toUpperCase()}
                            </div>
                            <div>
                                <div className="flex items-center gap-1">
                                    <span className="text-sm font-medium dark:text-gray-200">{member.username}</span>
                                    {member.role === 'admin' && <Crown size={12} className="text-yellow-500 fill-yellow-500" />}
                                </div>
                                <span className="text-xs text-gray-400">#{member.tag} • {member.role === 'admin' ? 'Admin' : 'Membre'}</span>
                            </div>
                        </div>
                        {isAdmin && member.id !== currentUser.id && (
                            <button onClick={() => handleKickMember(member.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Exclure">
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
      )}
    </div>
  );
};