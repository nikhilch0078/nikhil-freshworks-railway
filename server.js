// ============== CTI SERVER - Node.js Backend ==============
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const Call =require('./callSchema')

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server: server,
  // Important for ngrok compatibility
  perMessageDeflate: false
});

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.DATABASE_URL, {}).then(() => console.log("DB connected")).catch((err) => console.log("DB Error => ", err));


// Store connected Freshdesk clients
const freshdeskClients = new Set();
// Store call data
let activeCalls = new Map();

// ============== WEBSOCKET HANDLING ==============
wss.on('connection', (ws, req) => {
  console.log('✅ New Freshdesk client connected');
  console.log('📡 Client IP:', req.socket.remoteAddress);
  
  freshdeskClients.add(ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    event: 'connected',
    message: 'Connected to CTI Server',
    timestamp: new Date().toISOString(),
    server: 'Xorcom PBX CTI Server'
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Received from Freshdesk:', data);
      
      if (data.type === 'register') {
        ws.send(JSON.stringify({
          event: 'registered',
          message: 'Connected to CTI Server',
          clientId: Date.now().toString()
        }));
      }
      
      if (data.type === 'call_action') {
        handleCallAction(data, ws);
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('❌ Freshdesk client disconnected');
    freshdeskClients.delete(ws);
    console.log('📊 Active connections:', freshdeskClients.size);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// ============== HTTP ENDPOINTS (For Postman) ==============

// 1. Trigger a popup directly

async function createFreshdeskTicket(body) {
  const url = "https://iremboassist.freshdesk.com/api/v2/tickets";

  const payload = {
    email: body.caller_email || "caller@example.com",
    subject: `Testing Jitendra Incoming Call - ${body.requester_phone}`,
    description: `Call from ${body.requester_phone}`,
    status: 2,
    priority: 1,
    group_id: 47000660006,
    responder_id: 47094053714,
    custom_fields: {
      cf_institution: "IremboPay",
      cf_tags: "Voice of Customer",
      cf_issue_description626460: "Drop call before providing information",
      cf_customer_type: "Citizen",
      cf_language: "English",
      cf_tagged_by: "Aline Umutoniwase",
      cf_service341113: "RPPA_RRA_TD | Tender Document Fee",
      cf_tag311712: "Query"
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.credentialheader}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Freshdesk Error:", response.status, result);
      return;
    }

    console.log("Ticket Created Successfully:");
    console.log(result);

  } catch (error) {
    console.error("Request Failed:", error);
  }
}

// app.post('/api/trigger-popup', (req, res) => {
//   const mybody = req.body;
//   const { requester_phone, responder_email, call_reference_id } = req.body;
  
//   if (!requester_phone || !responder_email || !call_reference_id) {
//     return res.status(400).json({ 
//       error: 'All fields are required',
//       example: { 
//         "requester_phone": "16138888888", 
//         "responder_email": "agent@example.com", 
//         "call_reference_id": "777777777" 
//       }
//     });
//   }
  
//   console.log(`📢 Triggering popup for: ${requester_phone} (${responder_email})`);
  
//   // Create call data
//   const callData = {
//     event: 'incoming_call',
//     caller: {
//       callId: call_reference_id,
//       number: requester_phone,
//       email: responder_email,
//       source: 'postman',
//       timestamp: new Date().toISOString()
//     }
//   };
  
//   // Send to all connected Freshdesk clients
//   const clientsCount = broadcastToFreshdesk(callData);

//   createFreshdeskTicket(mybody);
  
//   res.json({
//     success: true,
//     message: `Popup triggered for ${requester_phone}`,
//     timestamp: new Date().toISOString(),
//     clients: clientsCount,
//     data: callData
//   });
// });

app.post("/api/trigger-popup", async (req, res) => {
  try {
    const mybody = req.body;
    const { requester_phone, responder_email, call_reference_id, call_duration } = req.body;

    if (!requester_phone || !responder_email || !call_reference_id) {
      return res.status(400).json({
        error: "All fields are required",
        example: {
          requester_phone: "16138888888",
          responder_email: "agent@example.com",
          call_reference_id: "777777777",
          call_duration: 120
        },
      });
    }

    console.log(`📢 Triggering popup for: ${requester_phone} (${responder_email})`);

    // Create call payload
    const callData = {
      event: "incoming_call",
      caller: {
        callId: call_reference_id,
        number: requester_phone,
        email: responder_email,
        source: "postman",
        timestamp: new Date().toISOString(),
      },
    };

    // 🔹 Save call in MongoDB
    const savedCall = await Call.create({
      callId: call_reference_id,
      callerPhone: requester_phone,
      responderEmail: responder_email,
      callName: "Incoming Call",
      callDuration: call_duration || 0,
      source: "postman",
    });

    // Send popup
    const clientsCount = broadcastToFreshdesk(callData);

    // Create Freshdesk ticket
    createFreshdeskTicket(mybody);

    res.json({
      success: true,
      message: `Popup triggered for ${requester_phone}`,
      clients: clientsCount,
      call_saved: true,
      call_db_id: savedCall._id,
      data: callData,
    });
  } catch (error) {
    console.error("❌ Error saving call:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger popup or save call",
    });
  }
});



// 2. Simulate a complete call
app.post('/api/simulate-call', (req, res) => {
  const { requester_phone, responder_email, call_reference_id, duration = 30 } = req.body;
  
  if (!requester_phone || !responder_email || !call_reference_id) {
    return res.status(400).json({ 
      error: 'All fields are required',
      example: { 
        "requester_phone": "16138888888", 
        "responder_email": "agent@example.com", 
        "call_reference_id": "777777777",
        "duration": 45 
      }
    });
  }
  
  console.log(`📞 Simulating call: ${requester_phone} for ${duration}s`);
  
  // Step 1: Incoming call
  broadcastToFreshdesk({
    event: 'incoming_call',
    caller: {
      callId: call_reference_id,
      number: requester_phone,
      email: responder_email,
      source: 'simulation',
      timestamp: new Date().toISOString()
    }
  });
  
  // Step 2: Auto-answer after 2 seconds
  setTimeout(() => {
    broadcastToFreshdesk({
      event: 'call_answered',
      callId: call_reference_id,
      timestamp: new Date().toISOString()
    });
  }, 2000);
  
  // Step 3: Auto-end after duration
  setTimeout(() => {
    broadcastToFreshdesk({
      event: 'call_ended',
      callId: call_reference_id,
      duration: duration,
      timestamp: new Date().toISOString()
    });
  }, duration * 1000);
  
  res.json({
    success: true,
    message: `Call simulation started for ${requester_phone}`,
    callId: call_reference_id,
    duration: duration,
    clients: freshdeskClients.size,
    timeline: [
      { action: 'incoming_call', after: '0s' },
      { action: 'call_answered', after: '2s' },
      { action: 'call_ended', after: `${duration}s` }
    ]
  });
});

// 3. Get server status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    clients: freshdeskClients.size,
    activeCalls: activeCalls.size,
    uptime: process.uptime(),
    endpoints: [
      { method: 'POST', path: '/api/trigger-popup', desc: 'Trigger popup' },
      { method: 'POST', path: '/api/simulate-call', desc: 'Simulate full call' },
      { method: 'GET', path: '/api/status', desc: 'Server status' },
      { method: 'GET', path: '/api/test', desc: 'Test endpoint' }
    ]
  });
});

// 4. Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: '🎉 CTI Server is running!',
    timestamp: new Date().toISOString(),
    server: 'Xorcom PBX CTI Integration',
    version: '1.0.0',
    endpoints: {
      triggerPopup: {
        method: 'POST',
        url: '/api/trigger-popup',
        body: { 
          requester_phone: "+250788314777", 
          responder_email: "agent@example.com", 
          call_reference_id: "777777777" 
        }
      },
      simulateCall: {
        method: 'POST', 
        url: '/api/simulate-call',
        body: { 
          requester_phone: "+250788314777", 
          responder_email: "agent@example.com", 
          call_reference_id: "777777777",
          duration: 30 
        }
      },
      status: { method: 'GET', url: '/api/status' }
    }
  });
});

// 5. WebSocket test endpoint
app.get('/api/ws-test', (req, res) => {
  const testData = {
    event: 'test_message',
    message: 'WebSocket test from server',
    timestamp: new Date().toISOString(),
    data: { test: 'success', code: 200 }
  };
  
  broadcastToFreshdesk(testData);
  
  res.json({
    success: true,
    message: 'Test message sent to all WebSocket clients',
    data: testData,
    clients: freshdeskClients.size
  });
});

// ============== UTILITY FUNCTIONS ==============
function broadcastToFreshdesk(data) {
  let sentCount = 0;
  
  freshdeskClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
        sentCount++;
      } catch (error) {
        console.error('Error sending to client:', error);
      }
    }
  });
  
  console.log(`📤 Sent to ${sentCount} client(s)`);
  return sentCount;
}

function handleCallAction(data, ws) {
  console.log('📞 Call action received:', data);
  
  // Here you would integrate with your actual PBX
  // For now, just acknowledge
  ws.send(JSON.stringify({
    event: 'action_acknowledged',
    action: data.action,
    callId: data.callId,
    timestamp: new Date().toISOString(),
    status: 'processed'
  }));
  
  // Log the action
  console.log(`📝 Action: ${data.action} for call ${data.callId}`);
}

// ============== HEALTH CHECK ==============
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    connections: freshdeskClients.size
  });
});

// ============== SERVER START ==============
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║        🚀 CTI Server Started!           ║
  ╠══════════════════════════════════════════╣
  ║ Port: ${PORT}                                ║
  ║ Local: http://localhost:${PORT}              ║
  ║ Network: http://0.0.0.0:${PORT}              ║
  ╠══════════════════════════════════════════╣
  ║         📋 Available Endpoints           ║
  ╠══════════════════════════════════════════╣
  ║ 🔔 POST /api/trigger-popup               ║
  ║ 📞 POST /api/simulate-call               ║
  ║ 📊 GET  /api/status                      ║
  ║ 🧪 GET  /api/test                        ║
  ║ 🔗 GET  /api/ws-test                     ║
  ║ 💚 GET  /health                          ║
  ╠══════════════════════════════════════════╣
  ║        WebSocket: ws://localhost:${PORT}     ║
  ║  Freshdesk URL: wss://your-ngrok-url     ║
  ╚══════════════════════════════════════════╝
  `);
  
  // Auto-test message
  setTimeout(() => {
    console.log('\n✅ Server ready for connections!');
    console.log('📡 Waiting for Freshdesk app to connect...');
  }, 1000);
});