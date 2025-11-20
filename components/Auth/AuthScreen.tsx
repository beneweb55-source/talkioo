import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { loginAPI, registerAPI } from '../../services/supabaseService';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { MessageCircleCode } from 'lucide-react';

export const AuthScreen: React.FC = () => {
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const response = await loginAPI(email, password);
        login(response.user, response.token);
      } else {
        const response = await registerAPI(username, email, password);
        login(response.user, response.token);
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
            <div className="h-14 w-14 bg-orange-600 rounded-xl shadow-lg flex items-center justify-center transform rotate-3 hover:rotate-0 transition-transform duration-300">
                <MessageCircleCode className="text-white" size={32} />
            </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 tracking-tight">
          Bienvenue sur <span className="text-orange-600">Talkio</span>
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {isLogin ? 'Connectez-vous à votre compte' : 'Rejoignez la conversation'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl shadow-orange-100/50 sm:rounded-lg sm:px-10 border border-gray-100">
          <form className="space-y-2" onSubmit={handleSubmit}>
            {!isLogin && (
              <Input
                label="Nom d'utilisateur"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex: Alex"
              />
            )}
            <Input
              label="Adresse Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
            />
            <Input
              label="Mot de passe"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            {error && (
              <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md border border-red-100">
                {error}
              </div>
            )}

            <div className="pt-4">
              <Button type="submit" isLoading={loading} className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500">
                {isLogin ? 'Se connecter' : "S'inscrire"}
              </Button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">
                  Ou
                </span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                }}
              >
                {isLogin ? 'Créer un compte' : 'J\'ai déjà un compte'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};