const express = require('express');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Mock database of usernames and real names
const userDatabase = {
    'john_doe': 'John Smith',
    'jane_smith': 'Jane Doe',
    'user123': 'Alex Johnson'
};

// API to fetch real name based on username
app.post('/api/getRealName', (req, res) => {
    const { username } = req.body;
    const realName = userDatabase[username.toLowerCase()] || null;
    res.json({ realName });
});

let users = new Map();
let agents = new Map();
let userAgentMap = new Map(); // Maps userId to agentId
let agentUserMap = new Map(); // Maps agentId to set of userIds

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const type = urlParams.get('type');
    const id = urlParams.get('id');
    const name = urlParams.get('name');
    const contact = urlParams.get('contact') || 'Not provided';

    if (type === 'user') {
        users.set(id, { ws, name, contact });
        console.log(`User connected: ${id} (${name})`);

        // Notify all agents of the new user
        agents.forEach(agent => {
            if (agent.ws.readyState === WebSocket.OPEN) {
                agent.ws.send(JSON.stringify({
                    type: 'user-connected',
                    userId: id,
                    name,
                    contact
                }));
            }
        });

        // Assign an agent if available
        let assignedAgent = null;
        agents.forEach((agent, agentId) => {
            if (!assignedAgent && (!agentUserMap.has(agentId) || agentUserMap.get(agentId).size < 2)) {
                assignedAgent = agentId;
            }
        });

        if (assignedAgent) {
            userAgentMap.set(id, assignedAgent);
            if (!agentUserMap.has(assignedAgent)) {
                agentUserMap.set(assignedAgent, new Set());
            }
            agentUserMap.get(assignedAgent).add(id);
            ws.send(JSON.stringify({
                type: 'agent-assigned',
                agent: agents.get(assignedAgent).name
            }));
        } else {
            ws.send(JSON.stringify({
                type: 'no-agents-available'
            }));
        }
    } else if (type === 'agent') {
        agents.set(id, { ws, name });
        console.log(`Agent connected: ${id} (${name})`);

        // Send the list of connected users to the agent
        users.forEach((user, userId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'user-connected',
                    userId,
                    name: user.name,
                    contact: user.contact
                }));
            }
        });

        if (!agentUserMap.has(id)) {
            agentUserMap.set(id, new Set());
        }
    }

    console.log('Server: Current userAgentMap:', [...userAgentMap.entries()]);
    console.log('Server: Current agentUserMap:', [...agentUserMap.entries()].map(([agentId, userSet]) => [agentId, [...userSet]]));

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'support-message') {
            const agentId = userAgentMap.get(id);
            if (agentId && agents.has(agentId)) {
                const agent = agents.get(agentId);
                if (agent.ws.readyState === WebSocket.OPEN) {
                    agent.ws.send(JSON.stringify({
                        type: 'support-message',
                        userId: id,
                        message: data.message
                    }));
                }
            }
        } else if (data.type === 'support-reply') {
            const userId = data.userId;
            if (users.has(userId)) {
                const user = users.get(userId);
                if (user.ws.readyState === WebSocket.OPEN) {
                    user.ws.send(JSON.stringify({
                        type: 'support-reply',
                        agent: data.agent,
                        message: data.message
                    }));
                }
            }
        } else if (data.type === 'support-end') {
            const userId = data.userId;
            console.log(`Server: Received support-end for user ${userId} from agent ${id}`);
            if (users.has(userId)) {
                const user = users.get(userId);
                const agentId = userAgentMap.get(userId);
                if (user.ws.readyState === WebSocket.OPEN) {
                    console.log(`Server: Sending support-end to user ${userId}`);
                    user.ws.send(JSON.stringify({
                        type: 'support-end'
                    }));
                } else {
                    console.warn(`Server: User ${userId} WebSocket is not open`);
                }
                userAgentMap.delete(userId);
                if (agentId && agentUserMap.has(agentId)) {
                    agentUserMap.get(agentId).delete(userId);
                    if (agentUserMap.get(agentId).size === 0) {
                        agentUserMap.delete(agentId);
                    }
                }
            } else {
                console.warn(`Server: User ${userId} not found`);
            }
            console.log('Server: Current userAgentMap after support-end:', [...userAgentMap.entries()]);
            console.log('Server: Current agentUserMap after support-end:', [...agentUserMap.entries()].map(([agentId, userSet]) => [agentId, [...userSet]]));
        }
    });

    ws.on('close', () => {
        if (type === 'user') {
            users.delete(id);
            const agentId = userAgentMap.get(id);
            if (agentId) {
                agentUserMap.get(agentId).delete(id);
                userAgentMap.delete(id);
                if (agents.has(agentId)) {
                    const agent = agents.get(agentId);
                    if (agent.ws.readyState === WebSocket.OPEN) {
                        agent.ws.send(JSON.stringify({
                            type: 'user-disconnected',
                            userId: id
                        }));
                    }
                }
            }
            console.log(`User disconnected: ${id}`);
        } else if (type === 'agent') {
            agents.delete(id);
            const assignedUsers = agentUserMap.get(id) || new Set();
            assignedUsers.forEach(userId => {
                if (users.has(userId)) {
                    const user = users.get(userId);
                    if (user.ws.readyState === WebSocket.OPEN) {
                        user.ws.send(JSON.stringify({
                            type: 'support-end'
                        }));
                    }
                    userAgentMap.delete(userId);
                }
            });
            agentUserMap.delete(id);
            console.log(`Agent disconnected: ${id}`);
        }
        console.log('Server: Current userAgentMap after close:', [...userAgentMap.entries()]);
        console.log('Server: Current agentUserMap after close:', [...agentUserMap.entries()].map(([agentId, userSet]) => [agentId, [...userSet]]));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});