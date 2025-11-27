import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { loginAPI, registerAPI } from '../../services/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CloudLightning } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const AuthScreen: React.FC = () => {
  const { login } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showWakeUpMessage, setShowWakeUpMessage] = useState(false);

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
    <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      {/* Animated Background */}
      <div className="absolute inset-0 w-full h-full">
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-brand-400/20 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-blue-400/20 rounded-full blur-[100px] animate-pulse delay-1000" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md p-6 z-10"
      >
        <div className="bg-white/70 dark:bg-gray-900/60 backdrop-blur-xl border border-white/50 dark:border-gray-800 rounded-3xl shadow-2xl overflow-hidden p-8">
          
          <div className="flex flex-col items-center mb-8">
            <motion.div 
              whileHover={{ rotate: 10, scale: 1.1 }}
              className="h-16 w-16 bg-gradient-to-br from-brand-500 to-red-600 rounded-2xl shadow-lg flex items-center justify-center mb-4"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-white">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </motion.div>
            <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
              Bienvenue sur Evo
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-2">
              {isLogin ? 'Ravis de vous revoir !' : 'Commencez l\'expérience aujourd\'hui'}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <AnimatePresence mode='wait'>
                {!isLogin && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    key="username-field"
                >
                    <Input
                        label="Nom d'utilisateur"
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="ex: Alex"
                    />
                </motion.div>
                )}
            </AnimatePresence>
            
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@evo.app"
            />
            
            <div className="relative">
                <Input
                label="Mot de passe"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                />
            </div>

            <AnimatePresence>
                {error && (
                <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-red-600 text-sm bg-red-50 dark:bg-red-500/10 dark:text-red-400 p-3 rounded-xl border border-red-100 dark:border-red-500/20 text-center"
                >
                    {error}
                </motion.div>
                )}
            </AnimatePresence>

            {showWakeUpMessage && (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="text-blue-600 text-xs bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-start gap-2"
                >
                    <CloudLightning className="flex-shrink-0" size={14} />
                    <span>Le serveur sort de veille (30s)... 🚀</span>
                </motion.div>
            )}

            <div className="pt-2">
              <Button type="submit" isLoading={loading} className="w-full">
                {isLogin ? 'Se connecter' : "Créer un compte"}
              </Button>
            </div>
          </form>

          <div className="mt-6 text-center">
             <button
                type="button"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                }}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors font-medium"
             >
                {isLogin ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
             </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};