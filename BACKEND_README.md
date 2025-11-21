# Configuration du Backend (Node.js + PostgreSQL)

Ce dossier contient le serveur Backend API + WebSocket pour l'application Talkio.
Il est conçu pour être hébergé sur **Render**, **Railway** ou tout VPS Node.js.

## 1. Structure

Le serveur utilise :
- **Express** : Pour l'API REST (Authentification, Messages, Amis).
- **Socket.io** : Pour le temps réel (Messages instantanés).
- **pg (node-postgres)** : Pour la connexion directe et performante à la base de données Neon (PostgreSQL).

## 2. Déploiement sur Render

1. Créez un "Web Service" sur Render connecté à votre repo GitHub.
2. **Root Directory** : Indiquez `server` (si ce dossier est à la racine de votre repo).
3. **Build Command** : `npm install`
4. **Start Command** : `node index.js`
5. **Variables d'environnement** :
   Ajoutez une variable `DATABASE_URL` avec votre lien de connexion Neon :
   `postgresql://neondb_owner:......@ep-misty-....aws.neon.tech/neondb?sslmode=require`

## 3. Initialisation Automatique

Au démarrage, le serveur exécute la fonction `initDB()` qui crée automatiquement les tables SQL nécessaires (`users`, `conversations`, `messages`, etc.) si elles n'existent pas.

Vous n'avez aucune migration manuelle à faire.

## 4. API Endpoints

- `POST /api/auth/register` : Inscription
- `POST /api/auth/login` : Connexion
- `GET /api/conversations` : Liste des chats
- `POST /api/messages` : Envoyer un message
- `POST /api/friend_requests` : Demander un ami
