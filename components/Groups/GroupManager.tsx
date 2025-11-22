import React, { useState, useEffect } from 'react';
import { Conversation, GroupMember, User } from '../../types';
import { 
    getGroupMembersAPI, 
    addGroupMemberAPI, 
    removeGroupMemberAPI, 
    updateGroupMemberRoleAPI, 
    updateGroupInfoAPI,
    getContactsAPI
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Users, Shield, ShieldAlert, Trash2, UserPlus, X, Edit2, Check } from 'lucide-react';

interface GroupManagerProps {
    conversation: Conversation;
    onClose: () => void;
}

export const GroupManager: React.FC<GroupManagerProps> = ({ conversation, onClose }) => {
    const { user } = useAuth();
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [groupName, setGroupName] = useState(conversation.name || '');
    const [isEditingName, setIsEditingName] = useState(false);

    const [showAddMember, setShowAddMember] = useState(false);
    const [contacts, setContacts] = useState<User[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    const myRole = members.find(m => m.user_id === user?.id)?.role || 'member';
    const canManage = myRole === 'admin' || myRole === 'owner';

    useEffect(() => {
        fetchMembers();
    }, [conversation.id]);

    const fetchMembers = async () => {
        try {
            const data = await getGroupMembersAPI(conversation.id);
            setMembers(data);
            setLoading(false);
        } catch (e) { console.error(e); }
    };

    const handleUpdateName = async () => {
        if (!groupName.trim()) return;
        try {
            await updateGroupInfoAPI(conversation.id, groupName);
            setIsEditingName(false);
        } catch (e) { alert("Erreur mise à jour nom"); }
    };

    const handleKick = async (targetId: string) => {
        if (!window.confirm("Retirer ce membre ?")) return;
        try {
            await removeGroupMemberAPI(conversation.id, targetId);
            setMembers(prev => prev.filter(m => m.user_id !== targetId));
        } catch (e) { alert("Impossible de retirer ce membre"); }
    };

    const handleRoleChange = async (targetId: string, currentRole: string) => {
        const newRole = currentRole === 'admin' ? 'member' : 'admin';
        try {
            await updateGroupMemberRoleAPI(conversation.id, targetId, newRole);
            setMembers(prev => prev.map(m => m.user_id === targetId ? { ...m, role: newRole } : m));
        } catch (e) { alert("Erreur changement rôle"); }
    };

    const handleAddMember = async (userId: string) => {
        try {
            await addGroupMemberAPI(conversation.id, userId);
            setShowAddMember(false);
            fetchMembers(); // Reload list
        } catch (e) { alert("Erreur ajout membre"); }
    };

    const openAddMember = async () => {
        setShowAddMember(true);
        const allContacts = await getContactsAPI();
        // Filter out already members
        const existingIds = new Set(members.map(m => m.user_id));
        setContacts(allContacts.filter(c => !existingIds.has(c.id)));
    };

    const filteredContacts = contacts.filter(c => 
        c.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
        c.tag.includes(searchQuery)
    );

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col h-[80vh] border border-gray-100 dark:border-gray-700 animate-in fade-in zoom-in duration-200">
                
                {/* Header */}
                <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                    <div className="flex-1 mr-4">
                        {isEditingName ? (
                            <div className="flex gap-2">
                                <input 
                                    className="flex-1 px-2 py-1 rounded border border-gray-300 dark:bg-gray-700 dark:text-white"
                                    value={groupName}
                                    onChange={e => setGroupName(e.target.value)}
                                    autoFocus
                                />
                                <button onClick={handleUpdateName} className="p-1 bg-green-100 text-green-700 rounded"><Check size={18}/></button>
                            </div>
                        ) : (
                            <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                                {groupName}
                                {canManage && (
                                    <button onClick={() => setIsEditingName(true)} className="text-gray-400 hover:text-orange-600"><Edit2 size={14}/></button>
                                )}
                            </h2>
                        )}
                        <p className="text-xs text-gray-500">{members.length} membres</p>
                    </div>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"/></button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4">
                    {showAddMember ? (
                        <div className="animate-in fade-in">
                            <div className="flex items-center gap-2 mb-4">
                                <button onClick={() => setShowAddMember(false)} className="text-gray-500 hover:text-gray-800 dark:text-gray-400">← Retour</button>
                                <h3 className="font-bold dark:text-gray-200">Ajouter un participant</h3>
                            </div>
                            <Input placeholder="Rechercher un ami..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                            <div className="mt-2 space-y-1">
                                {filteredContacts.length === 0 && <p className="text-center text-gray-400 py-4">Aucun contact disponible.</p>}
                                {filteredContacts.map(contact => (
                                    <div key={contact.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                                        <span className="font-medium dark:text-gray-200">{contact.username}<span className="text-xs text-gray-400">#{contact.tag}</span></span>
                                        <button onClick={() => handleAddMember(contact.id)} className="bg-orange-600 text-white px-3 py-1 rounded text-sm">Ajouter</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <>
                            {loading ? (
                                <div className="text-center py-8">Chargement...</div>
                            ) : (
                                <div className="space-y-2">
                                    {members.map(member => (
                                        <div key={member.user_id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full flex items-center justify-center font-bold text-sm">
                                                    {member.username.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                                                            {member.username} {member.user_id === user?.id && "(Vous)"}
                                                        </span>
                                                        {member.role === 'owner' && <ShieldAlert size={14} className="text-red-500" title="Propriétaire"/>}
                                                        {member.role === 'admin' && <Shield size={14} className="text-blue-500" title="Admin"/>}
                                                    </div>
                                                    <div className="text-[10px] text-gray-400">
                                                        Rejoint le {new Date(member.joined_at).toLocaleDateString()}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Actions */}
                                            {canManage && member.user_id !== user?.id && member.role !== 'owner' && (
                                                <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                    {myRole === 'owner' && (
                                                        <button 
                                                            onClick={() => handleRoleChange(member.user_id, member.role)}
                                                            className={`p-1.5 rounded ${member.role === 'admin' ? 'text-blue-500 bg-blue-50 hover:bg-blue-100' : 'text-gray-400 hover:text-blue-500 hover:bg-gray-100'}`}
                                                            title={member.role === 'admin' ? "Rétrograder membre" : "Promouvoir Admin"}
                                                        >
                                                            <Shield size={16} />
                                                        </button>
                                                    )}
                                                    <button 
                                                        onClick={() => handleKick(member.user_id)}
                                                        className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                        title="Exclure"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {!showAddMember && canManage && (
                    <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                        <Button onClick={openAddMember} className="flex items-center justify-center gap-2 w-full">
                            <UserPlus size={18} /> Ajouter un membre
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};