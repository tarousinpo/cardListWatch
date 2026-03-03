const sendDiscordNotification = require('path/to/sendDiscordNotification');

// Existing logic

if (process.env.TEST_DISCORD === '1') {
    // Send a Discord test notification
    sendDiscordNotification('Union Arena', { content: 'Test notification without running fetch/parsers or modifying docs/status.json' });
    process.exit(0);
}

// Continue with existing logic...