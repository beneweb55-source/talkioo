import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { loginAPI, registerAPI } from '../../services/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { MessageCircleCode, CloudLightning } from 'lucide-react';

export const AuthScreen: React.FC = () => {
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showWakeUpMessage, setShowWakeUpMessage] = useState(false);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setShowWakeUpMessage(false);

    const wakeUpTimer = setTimeout(() => {
        setShowWakeUpMessage(true);
    }, 2500);

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
      clearTimeout(wakeUpTimer);
      setLoading(false);
      setShowWakeUpMessage(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-900 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="sm:mx-auto sm:w-full sm:max-w-md mb-8">
        <div className="flex justify-center">
            <div className="h-16 w-16 bg-orange-600 rounded-2xl shadow-xl flex items-center justify-center transform rotate-3 hover:rotate-0 transition-transform duration-300">
                <MessageCircleCode className="text-white" size={40} />
            </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          <span className="text-orange-600">Talkio</span> Web
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          {isLogin ? 'Bon retour parmi nous !' : 'Créez votre compte en 30s'}
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white dark:bg-gray-800 py-8 px-6 shadow-2xl shadow-orange-100/50 dark:shadow-black/30 rounded-2xl sm:px-10 border border-gray-100 dark:border-gray-700 transition-colors">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {!isLogin && (
              <Input
                label="Nom d'utilisateur"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ex: Alex"
                className="py-3"
              />
            )}
            <Input
              label="Adresse Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
              className="py-3"
            />
            <Input
              label="Mot de passe"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="py-3"
            />

            {error && (
              <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-4 rounded-xl border border-red-100 dark:border-red-900/30 animate-in fade-in">
                {error}
              </div>
            )}

            {showWakeUpMessage && (
                <div className="text-blue-600 text-sm bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-start gap-2 animate-in fade-in">
                    <CloudLightning className="flex-shrink-0 mt-0.5" size={18} />
                    <span>
                        Le serveur démarre, merci de patienter... 🚀
                    </span>
                </div>
            )}

            <div className="pt-2">
              <Button type="submit" isLoading={loading} className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500 h-12 text-lg font-semibold shadow-lg shadow-orange-200 dark:shadow-none">
                {isLogin ? 'Se connecter' : "S'inscrire"}
              </Button>
            </div>
          </form>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-gray-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  Ou
                </span>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                  setShowWakeUpMessage(false);
                }}
                className="dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 h-12"
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