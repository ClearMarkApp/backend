require('dotenv').config();
const express = require('express');

// app initialization
const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());

// API Key Authentication
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is required' });
  }
  
  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  next();
};

app.use(authenticateApiKey);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});


// begin listening to port / start server
app.listen(port, () => {
  console.log(`Server started on port: ${port}`);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});
