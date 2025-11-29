import React, { useState } from 'react';
import { Conversation, User } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { updateGroup, addMembers, removeMember, leaveGroup } from '../../services/api';
import { Users, UserPlus, Trash2, LogOut, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const MotionDiv = motion.div as any;

interface GroupManagerProps {
  conversation: Conversation;
  currentUser: User;
  onClose: () => void;
  onUpdate: () => void;
  contacts: User[]; // List of available contacts to add
}

export const GroupManager: React.FC<GroupManagerProps> = ({ 
  conversation, 
  currentUser, 
  onClose, 
  onUpdate,
  contacts 
}) => {
  const [name, setName] = useState(conversation.name || '');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isAddMode, setIsAddMode] = useState(false);

  // Mock members for now since we don't have a fetchMembersAPI in this context yet
  // In a real implementation, we would fetch members on mount
  const [members, setMembers] = useState<any[]>([]); 

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsLoading(true);
    try {
      await updateGroup(conversation.id, { name });
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
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!window.confirm("Voulez-vous vraiment quitter ce groupe ?")) return;
    try {
      await leaveGroup(conversation.id);
      onClose(); // Close manager, parent should handle navigation
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-800">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
          <Settings className="text-brand-500" /> Gestion du Groupe
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">Fermer</button>
      </div>

      <form onSubmit={handleUpdateName} className="mb-6">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input 
              label="Nom du groupe" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
            />
          </div>
          <div className="mb-4">
            <Button type="submit" disabled={isLoading || name === conversation.name}>
              OK
            </Button>
          </div>
        </div>
      </form>

      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Membres</h3>
          <button 
            onClick={() => setIsAddMode(!isAddMode)}
            className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium"
          >
            <UserPlus size={14} /> {isAddMode ? 'Annuler' : 'Ajouter'}
          </button>
        </div>

        <AnimatePresence>
          {isAddMode && (
            <MotionDiv 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-4 overflow-hidden"
            >
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-xl max-h-40 overflow-y-auto">
                {contacts.map(contact => (
                  <div 
                    key={contact.id} 
                    onClick={() => setSelectedContacts(prev => prev.includes(contact.id) ? prev.filter(c => c !== contact.id) : [...prev, contact.id])}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm ${selectedContacts.includes(contact.id) ? 'bg-brand-100 text-brand-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-300'}`}
                  >
                    <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedContacts.includes(contact.id) ? 'bg-brand-500 border-brand-500' : 'border-gray-400'}`}>
                      {selectedContacts.includes(contact.id) && <div className="w-2 h-2 bg-white rounded-full" />}
                    </div>
                    {contact.username}
                  </div>
                ))}
              </div>
              <Button onClick={handleAddMembers} isLoading={isLoading} className="mt-2 text-xs py-1.5">
                Confirmer l'ajout
              </Button>
            </MotionDiv>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {/* List members here - Requires API to fetch members */}
          <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-center text-sm text-gray-500">
            Gestion des membres bientôt disponible
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mt-4">
        <Button variant="danger" onClick={handleLeaveGroup} className="w-full flex items-center justify-center gap-2">
          <LogOut size={16} /> Quitter le groupe
        </Button>
      </div>
    </div>
  );
};