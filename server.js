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
// Store agent-to-user assignments (agent WebSocket -> array of user WebSockets)
const agentAssignments = new Map();
// Store pending users waiting for an agent response
const pendingUsers = new Map();

const agents = [
    { email: 'shafeenafarheen2025@gmail.com', password: 'shafeena123', name: 'Shafeena' },
    { email: 'demo@gmail.com', password: '123456', name: 'Devend' }
];

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type') || 'user';
    const clientId = url.searchParams.get('id') || `client_${Date.now()}`;

    if (clientType === 'agent') {
        const email = url.searchParams.get('email');
        const password = url.searchParams.get('password');

        const agent = agents.find(a => a.email === email && a.password === password);
        if (!agent) {
            ws.send(JSON.stringify({ type: 'auth-error', message: 'Invalid email or password' }));
            ws.close();
            return;
        }

        clients.set(ws, { type: clientType, id: clientId, name: agent.name });
        agentAssignments.set(ws, []);
        console.log(`Agent connected: ${agent.name} (${clientId})`);

        // Send any pending users to Devend or Shafeena
        if (agent.name === 'Devend' || agent.name === 'Shafeena') {
            for (const [userWs, userInfo] of pendingUsers) {
                ws.send(JSON.stringify({
                    type: 'new-user-waiting',
                    userId: userInfo.id,
                    userName: userInfo.name,
                    contactNumber: userInfo.contact
                }));
            }
        }
    } else {
        const userName = url.searchParams.get('name') || 'Anonymous';
        const contactNumber = url.searchParams.get('contact') || 'N/A';
        clients.set(ws, { type: clientType, id: clientId, name: userName, contact: contactNumber });
        console.log(`User connected: ${clientId} (${userName}, ${contactNumber})`);

        // Add to pending users and notify Devend and Shafeena
        pendingUsers.set(ws, { id: clientId, name: userName, contact: contactNumber });
        notifySpecificAgents('new-user-waiting', {
            userId: clientId,
            userName: userName,
            contactNumber: contactNumber
        });
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            const clientInfo = clients.get(ws);

            if (data.type === 'support-message' && clientInfo.type === 'user') {
                const assignedAgent = findAgentForUser(ws);
                if (assignedAgent) {
                    assignedAgent.send(JSON.stringify({
                        type: 'support-message',
                        userId: clientInfo.id,
                        userName: clientInfo.name,
                        contactNumber: clientInfo.contact,
                        message: data.message
                    }));
                }
            } else if (data.type === 'claim-user' && clientInfo.type === 'agent') {
                const userWs = findUserById(data.userId);
                if (userWs && pendingUsers.has(userWs) && (agentAssignments.get(ws) || []).length < 2) {
                    pendingUsers.delete(userWs);
                    const users = agentAssignments.get(ws) || [];
                    users.push(userWs);
                    agentAssignments.set(ws, users);

                    userWs.send(JSON.stringify({
                        type: 'agent-assigned',
                        agent: clientInfo.name
                    }));
                    ws.send(JSON.stringify({
                        type: 'user-assigned',
                        userId: data.userId,
                        userName: clients.get(userWs).name,
                        contactNumber: clients.get(userWs).contact
                    }));

                    // Notify other agents to remove this user from their pending list
                    notifySpecificAgents('user-claimed', { userId: data.userId }, ws);
                }
            } else if (data.type === 'support-reply' && clientInfo.type === 'agent') {
                const userWs = findUserById(data.userId);
                if (userWs && userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'support-reply',
                        agent: clientInfo.name,
                        message: data.message
                    }));
                }
            } else if (data.type === 'support-end' && clientInfo.type === 'agent') {
                const assignedUsers = agentAssignments.get(ws) || [];
                assignedUsers.forEach(userWs => {
                    if (userWs.readyState === WebSocket.OPEN) {
                        userWs.send(JSON.stringify({
                            type: 'support-end',
                            agent: clientInfo.name
                        }));
                    }
                    clients.delete(userWs);
                });
                agentAssignments.set(ws, []);
                ws.send(JSON.stringify({
                    type: 'support-end',
                    message: 'Support session ended successfully.'
                }));
                console.log(`Agent ${clientInfo.name} ended the support session`);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        const clientInfo = clients.get(ws);
        if (clientInfo.type === 'agent') {
            const assignedUsers = agentAssignments.get(ws) || [];
            assignedUsers.forEach(userWs => {
                if (userWs.readyState === WebSocket.OPEN) {
                    userWs.send(JSON.stringify({
                        type: 'support-end',
                        agent: clientInfo.name
                    }));
                }
                clients.delete(userWs);
            });
            agentAssignments.delete(ws);
            console.log(`Agent disconnected: ${clientInfo.name} (${clientId})`);
        } else {
            pendingUsers.delete(ws);
            const agentWs = findAgentForUser(ws);
            if (agentWs) {
                const users = agentAssignments.get(agentWs);
                agentAssignments.set(agentWs, users.filter(u => u !== ws));
            }
            console.log(`User disconnected: ${clientInfo.id} (${clientInfo.name})`);
        }
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

function notifySpecificAgents(type, data, excludeWs = null) {
    wss.clients.forEach(client => {
        const info = clients.get(client);
        if (client.readyState === WebSocket.OPEN && info.type === 'agent' && 
            (info.name === 'Devend' || info.name === 'Shafeena') && client !== excludeWs) {
            client.send(JSON.stringify({ type, ...data }));
        }
    });
}

function findAgentForUser(userWs) {
    for (const [agentWs, users] of agentAssignments) {
        if (users.includes(userWs)) {
            return agentWs;
        }
    }
    return null;
}

function findUserById(userId) {
    for (const [ws, info] of clients) {
        if (info.type === 'user' && info.id === userId) {
            return ws;
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Support Agent WebSocket Server running on port ${PORT}`);
});