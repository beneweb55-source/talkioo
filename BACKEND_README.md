# Configuration du Backend (Node.js + Prisma + Neon)

Ce fichier liste les étapes pour initialiser votre serveur Backend qui se connectera à la base de données Neon.

## 1. Initialisation du projet

Ouvrez votre terminal à la racine du dossier où vous hébergerez le backend (ou dans ce projet si vous utilisez Next.js API Routes) :

```bash
# Initialiser le package.json si ce n'est pas fait
npm init -y

# Installer Prisma et le Client Prisma
npm install prisma --save-dev
npm install @prisma/client
```

## 2. Configuration de l'environnement

Créez un fichier `.env` à la racine et ajoutez votre URL de connexion Neon (celle commençant par `postgresql://` et finissant par `sslmode=require`).

```env
# .env
DATABASE_URL="postgresql://neondb_owner:npg_XPSO...e-central-1.aws.neon.tech/neondb?sslmode=require"
```

> **Sécurité :** Ne commitez jamais ce fichier `.env` sur GitHub. Ajoutez-le à votre `.gitignore`.

## 3. Synchronisation avec la Base de Données

Cette commande va lire le fichier `prisma/schema.prisma` et créer les tables (users, conversations, etc.) dans votre base de données Neon.

```bash
npx prisma db push
```

## 4. Génération du Client

Générez le client TypeScript pour pouvoir utiliser `prisma.user.findMany()` etc. dans votre code.

```bash
npx prisma generate
```

## 5. Utilisation (Exemple)

Dans vos fichiers API (ex: `pages/api/auth/register.ts` ou `server.js`) :

```javascript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Exemple : Créer un user
async function main() {
  const newUser = await prisma.user.create({
    data: {
      username: 'Alice',
      tag: '1234',
      email: 'alice@test.com',
      password_hash: 'hash_securise_ici'
    }
  });
  console.log(newUser);
}
```
