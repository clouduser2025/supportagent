const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Connect to MongoDB
mongoose.connect('mongodb://<your-mongodb-uri>', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Agent Schema
const agentSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true }
});

const Agent = mongoose.model('Agent', agentSchema);

// Register a new agent
app.post('/register', async (req, res) => {
    const { email, password, name } = req.body;
    try {
        const existingAgent = await Agent.findOne({ email });
        if (existingAgent) {
            return res.status(400).json({ message: 'Email already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const agent = new Agent({ email, password: hashedPassword, name });
        await agent.save();
        res.status(201).json({ message: 'Agent registered successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error registering agent', error });
    }
});

// Login an agent
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const agent = await Agent.findOne({ email });
        if (!agent) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, agent.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const token = jwt.sign({ email: agent.email, name: agent.name }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1h' });
        res.json({ token, name: agent.name });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error });
    }
});

// WebSocket server with authentication
const clients = new Map();

wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');

    // Parse query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const clientType = url.searchParams.get('type') || 'user';
    const clientId = url.searchParams.get('id') || `client_${Date.now()}`;
    const token = url.searchParams.get('token');

    // Authenticate agents
    if (clientType === 'agent') {
        if (!token) {
            ws.close(4000, 'Authentication token required');
            return;
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
            console.log(`Agent authenticated: ${decoded.name}`);
        } catch (error) {
            ws.close(4001, 'Invalid authentication token');
            return;
        }
    }

    clients.set(ws, { type: clientType, id: clientId });
    console.log(`Client connected: ${clientId} (${clientType})`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            if (data.type === 'support-message' && clientType === 'user') {
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
                console.log(`Agent ${data.agent} replied: ${data.message}`);
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

    ws.on('close', (code, reason) => {
        console.log(`Client disconnected: ${clientId} (${clientType}) - Code: ${code}, Reason: ${reason}`);
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
    console.log(`Support Agent Server running on port ${PORT}`);
});