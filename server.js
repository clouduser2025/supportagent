const http = require('http');
const WebSocket = require('ws');
const url = require('url');

// Create an HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Support Agent WebSocket Server\n');
});

// Create a WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients (users and agents)
const clients = new Map();
// Store agent-to-user assignments
const agentAssignments = new Map();
// Maximum users per agent
const MAX_USERS_PER_AGENT = 3;

// Store agent credentials (email, password, name) - In production, use a database and hash passwords
const agents = [
    { email: 'shafeenafarheen2025@gmail.com', password: 'shafeena123', name: 'Shafeena' },
    { email: 'demo@gmail.com', password: '123456', name: 'Devend' }
];

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');

    // Parse the URL and query parameters
    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query;
    const clientType = query.type || 'user'; // Default to 'user' if not specified
    const clientId = query.id || `client_${Date.now()}`; // Unique ID for each client
    let clientName = query.name; // Get the username from query parameter
    const contact = query.contact || 'Not provided'; // Get the contact number (if provided)

    // Debug the raw query parameters to ensure 'name' is being received
    console.log('Query parameters:', query);
    console.log('Extracted clientName:', clientName);

    // Validate and sanitize the username
    if (!clientName || clientName.trim().length === 0 || clientName.trim().length > 50 || clientName === 'undefined') {
        clientName = 'Anonymous'; // Fallback to 'Anonymous' if the name is invalid, missing, or 'undefined'
    } else {
        clientName = clientName.trim();
    }

    // If the client is an agent, require authentication
    if (clientType === 'agent') {
        const email = query.email;
        const password = query.password;

        // Find the agent in the credentials store
        const agent = agents.find(a => a.email === email && a.password === password);
        if (!agent) {
            ws.send(JSON.stringify({ type: 'auth-error', message: 'Invalid email or password' }));
            ws.close();
            return;
        }

        // Store the agent's details
        clients.set(ws, { type: clientType, id: clientId, name: agent.name });
        agentAssignments.set(clientId, new Set()); // Initialize an empty set of users for this agent
        console.log(`Agent connected: ${agent.name} (${clientId})`);

        // Send authentication success message to the agent
        ws.send(JSON.stringify({ type: 'authenticated', agentId: clientId }));
    } else {
        // For users, assign them to an available agent
        clients.set(ws, { type: clientType, id: clientId, name: clientName, contact });
        console.log(`User connected: ${clientId} (${clientType}) - Name: ${clientName}, Contact: ${contact}`);

        // Assign the user to an agent
        let assignedAgentWs = null;
        let assignedAgentId = null;

        for (const [agentWs, agentInfo] of clients) {
            if (agentInfo.type === 'agent') {
                const assignedUsers = agentAssignments.get(agentInfo.id);
                if (assignedUsers.size < MAX_USERS_PER_AGENT) {
                    assignedUsers.add(clientId);
                    assignedAgentWs = agentWs;
                    assignedAgentId = agentInfo.id;
                    clients.get(ws).agentId = agentInfo.id; // Store the assigned agent ID in the user's client info
                    break;
                }
            }
        }

        if (!assignedAgentWs) {
            ws.send(JSON.stringify({
                type: 'support-message',
                message: 'No agents are available at the moment. Please try again later.'
            }));
            ws.close();
            return;
        }

        console.log(`User ${clientId} (Name: ${clientName}) assigned to agent ${assignedAgentId}`);

        // Notify the agent of the new user
        if (assignedAgentWs && assignedAgentWs.readyState === WebSocket.OPEN) {
            assignedAgentWs.send(JSON.stringify({
                type: 'newUser',
                userId: clientId,
                userName: clientName // Send the real username to the agent
            }));
        }
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString()); // Ensure message is a string
            console.log('Received:', data);

            const clientInfo = clients.get(ws);

            // Handle messages based on client type
            if (data.type === 'support-message' && clientInfo.type === 'user') {
                // User sent a message, send it to their assigned agent
                const agentId = clientInfo.agentId;
                let agentWs = null;

                for (const [ws, info] of clients) {
                    if (info.type === 'agent' && info.id === agentId) {
                        agentWs = ws;
                        break;
                    }
                }

                if (agentWs && agentWs.readyState === WebSocket.OPEN) {
                    agentWs.send(JSON.stringify({
                        type: 'support-message',
                        user: clientInfo.name, // Use the actual username
                        userId: clientInfo.id, // Include userId for tracking
                        message: data.message,
                        isFirstMessage: !clientInfo.hasSentMessage // Flag to indicate if this is the user's first message
                    }));

                    // Mark that the user has sent a message
                    clientInfo.hasSentMessage = true;
                }
            } else if (data.type === 'support-reply' && clientInfo.type === 'agent') {
                // Agent sent a reply, send it to the specific user
                const userId = data.userId; // The userId should be included in the reply
                let userWs = null;

                for (const [ws, info] of clients) {
                    if (info.type === 'user' && info.id === userId) {
                        userWs = ws;
                        break;
                    }
                }

                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'support-reply',
                        agent: clientInfo.name,
                        message: data.message
                    }));
                }
            } else if (data.type === 'support-end' && clientInfo.type === 'agent') {
                // Agent ended the session for a specific user
                const userId = data.userId; // The userId should be included in the end session request
                let userWs = null;

                for (const [ws, info] of clients) {
                    if (info.type === 'user' && info.id === userId) {
                        userWs = ws;
                        break;
                    }
                }

                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'support-end',
                        agent: clientInfo.name,
                        message: 'Support session ended by the agent.'
                    }));
                    userWs.close();
                }

                // Remove the user from the agent's assigned users
                const assignedUsers = agentAssignments.get(clientInfo.id);
                if (assignedUsers) {
                    assignedUsers.delete(userId);
                }

                // Notify the agent that the session has ended for this user
                ws.send(JSON.stringify({
                    type: 'support-end',
                    userId: userId,
                    message: `Support session with ${userId} ended successfully.`
                }));
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'An error occurred while processing your message.'
            }));
        }
    });

    ws.on('close', () => {
        const clientInfo = clients.get(ws);
        console.log(`Client disconnected: ${clientInfo.id} (${clientInfo.type})`);

        if (clientInfo.type === 'agent') {
            // Notify all assigned users that the agent has disconnected
            const assignedUsers = agentAssignments.get(clientInfo.id) || new Set();
            for (const userId of assignedUsers) {
                let userWs = null;
                for (const [ws, info] of clients) {
                    if (info.type === 'user' && info.id === userId) {
                        userWs = ws;
                        break;
                    }
                }
                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'support-end',
                        message: 'Agent has disconnected. Please try again later.'
                    }));
                    userWs.close();
                }
            }
            agentAssignments.delete(clientInfo.id);
        } else if (clientInfo.type === 'user') {
            // Remove the user from the agent's assigned users
            const agentId = clientInfo.agentId;
            if (agentId) {
                const assignedUsers = agentAssignments.get(agentId);
                if (assignedUsers) {
                    assignedUsers.delete(clientInfo.id);
                }

                // Notify the agent of the user disconnection
                let agentWs = null;
                for (const [ws, info] of clients) {
                    if (info.type === 'agent' && info.id === agentId) {
                        agentWs = ws;
                        break;
                    }
                }
                if (agentWs && agentWs.readyState === WebSocket.OPEN) {
                    agentWs.send(JSON.stringify({
                        type: 'user-disconnected',
                        userId: clientInfo.id,
                        userName: clientInfo.name
                    }));
                }
            }
        }

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