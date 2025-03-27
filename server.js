// support-backend-agent/server.js
const http = require('http');
const WebSocket = require('ws');

// Create an HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Support Agent WebSocket Server\n');
});

// Create a WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients (users and agents)
const clients = new Map();

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');

    // Determine client type based on query parameter or custom header
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type') || 'user'; // Default to 'user' if not specified
    const clientId = url.searchParams.get('id') || `client_${Date.now()}`; // Unique ID for each client

    clients.set(ws, { type: clientType, id: clientId });
    console.log(`Client connected: ${clientId} (${clientType})`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            // Broadcast messages based on client type
            if (data.type === 'support-message' && clientType === 'user') {
                // User sent a message, broadcast to all agents
                wss.clients.forEach((client) => {
                    const clientInfo = clients.get(client);
                    if (client.readyState === WebSocket.OPEN && clientInfo.type === 'agent') {
                        client.send(JSON.stringify({
                            type: 'support-message',
                            user: data.user || clientInfo.id,
                            message: data.message
                        }));
                    }
                });
            } else if (data.type === 'support-reply' && clientType === 'agent') {
                // Agent sent a reply, broadcast to all users
                wss.clients.forEach((client) => {
                    const clientInfo = clients.get(client);
                    if (client.readyState === WebSocket.OPEN && clientInfo.type === 'user') {
                        client.send(JSON.stringify({
                            type: 'support-reply',
                            agent: data.agent,
                            message: data.message
                        }));
                    }
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId} (${clientType})`);
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Support Agent WebSocket Server running on port ${PORT}`);
});