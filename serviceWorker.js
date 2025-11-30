self.addEventListener('push', function(event) {
    if (event.data) {
        let data = {};
        try {
            data = event.data.json();
        } catch(e) {
            data = { title: 'Nouveau message', body: event.data.text() };
        }
        
        const options = {
            body: data.body,
            icon: data.icon || '/logo192.png',
            badge: '/logo192.png',
            vibrate: [100, 50, 100],
            data: data.data || {} // Contains conversationId
        };

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Focus existing window or open new
    event.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(clientList) {
            // Try to find an open tab
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});