import { useState, useEffect, useCallback } from 'react';
import { getVapidPublicKeyAPI, subscribeToPushAPI } from '../services/api';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const usePushNotifications = (userId: string | undefined) => {
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [isSubscribed, setIsSubscribed] = useState(false);

    useEffect(() => {
        if ('Notification' in window) {
            setPermission(Notification.permission);
            checkSubscriptionStatus();
        }
    }, [userId]);

    const checkSubscriptionStatus = async () => {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                const subscription = await registration.pushManager.getSubscription();
                setIsSubscribed(!!subscription);
                return !!subscription;
            }
        }
        setIsSubscribed(false);
        return false;
    };

    const subscribeToPush = useCallback(async () => {
        if (!userId) return;
        
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log("Push notifications not supported.");
            return;
        }

        try {
            const scriptUrl = '/serviceWorker.js';
            const registration = await navigator.serviceWorker.register(scriptUrl, { scope: '/' });
            await navigator.serviceWorker.ready;

            const { publicKey } = await getVapidPublicKeyAPI();
            if (!publicKey) throw new Error("No public key");
            
            const convertedVapidKey = urlBase64ToUint8Array(publicKey);

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            });

            await subscribeToPushAPI(subscription);
            setIsSubscribed(true);
            console.log("Push notifications subscribed.");

        } catch (error: any) {
            if (error.name === 'NotAllowedError') {
                setPermission('denied');
            }
            console.error("Failed to subscribe:", error);
        }
    }, [userId]);

    const unsubscribeFromPush = useCallback(async () => {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                const subscription = await registration.pushManager.getSubscription();
                if (subscription) {
                    await subscription.unsubscribe();
                    setIsSubscribed(false);
                    console.log("Push notifications unsubscribed.");
                }
            }
        }
    }, []);

    // Logic to refresh subscription on load ONLY IF it already exists
    // This allows "permission: granted" but "subscription: null" (User disabled it in app)
    useEffect(() => {
        const sync = async () => {
            if (userId && permission === 'granted') {
                const hasSub = await checkSubscriptionStatus();
                if (hasSub) {
                    // Only re-run subscription logic (to update backend) if browser actually has a subscription
                    subscribeToPush();
                }
            }
        };
        sync();
    }, [userId, permission, subscribeToPush]);

    const requestPermission = async () => {
        if (!('Notification' in window)) return;
        try {
            const result = await Notification.requestPermission();
            setPermission(result);
            if (result === 'granted') {
                await subscribeToPush();
            }
        } catch (error) {
            console.error("Error requesting permission:", error);
        }
    };

    const togglePush = async () => {
        if (isSubscribed) {
            await unsubscribeFromPush();
        } else {
            if (Notification.permission === 'granted') {
                await subscribeToPush();
            } else {
                await requestPermission();
            }
        }
    };

    return { permission, requestPermission, isSubscribed, togglePush };
};