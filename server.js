// supportagent/server.js
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

// Store agent credentials (email, password, name) - In production, use a database and hash passwords
const agents = [
    { email: 'shafeenafarheen2025@gmail.com', password: 'shafeena123', name: 'Shafeena' }, // Example password for Shafeena
    { email: 'demo@gmail.com', password: '123456', name: 'Devend' }
];

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');

    // Determine client type based on query parameter
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type') || 'user'; // Default to 'user' if not specified
    const clientId = url.searchParams.get('id') || `client_${Date.now()}`; // Unique ID for each client

    // If the client is an agent, require authentication
    if (clientType === 'agent') {
        const email = url.searchParams.get('email');
        const password = url.searchParams.get('password');

        // Find the agent in the credentials store
        const agent = agents.find(a => a.email === email && a.password === password);
        if (!agent) {
            ws.send(JSON.stringify({ type: 'auth-error', message: 'Invalid email or password' }));
            ws.close();
            return;
        }

        // Store the agent's name with the WebSocket connection
        clients.set(ws, { type: clientType, id: clientId, name: agent.name });
        console.log(`Agent connected: ${agent.name} (${clientId})`);
    } else {
        clients.set(ws, { type: clientType, id: clientId });
        console.log(`Client connected: ${clientId} (${clientType})`);
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            const clientInfo = clients.get(ws);

            // Broadcast messages based on client type
            if (data.type === 'support-message' && clientInfo.type === 'user') {
                // User sent a message, broadcast to all agents
                wss.clients.forEach((client) => {
                    const info = clients.get(client);
                    if (client.readyState === WebSocket.OPEN && info.type === 'agent') {
                        client.send(JSON.stringify({
                            type: 'support-message',
                            user: data.user || info.id,
                            message: data.message
                        }));
                    }
                });
            } else if (data.type === 'support-reply' && clientInfo.type === 'agent') {
                // Agent sent a reply, broadcast to all users with the agent's name
                wss.clients.forEach((client) => {
                    const info = clients.get(client);
                    if (client.readyState === WebSocket.OPEN && info.type === 'user') {
                        client.send(JSON.stringify({
                            type: 'support-reply',
                            agent: clientInfo.name, // Use the agent's name (Devend or Shafeena)
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
        const clientInfo = clients.get(ws);
        console.log(`Client disconnected: ${clientInfo.id} (${clientInfo.type})`);
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