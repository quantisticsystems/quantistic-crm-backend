// ============================================================
// Quantistic Systems — CRM Webhook Backend
// Node.js + Express  |  Deploy on Railway, Render, or Vercel
// ============================================================
const express = require('express');
const crypto  = require('crypto');
const app     = express();

app.use(express.json());

// ── In-memory store (swap for Supabase/Postgres in production) ──
const leads        = new Map();
const appointments = new Map();
const events       = [];

// ── Auth middleware ──
function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ── CORS (allow your hosted CRM domain) ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  process.env.CRM_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================================
// LEADS
// ============================================================

// POST /api/leads  — n8n calls this when a new enquiry arrives
app.post('/api/leads', auth, (req, res) => {
  const {
    homeowner_name, property_address, postcode,
    channel, stage, timeline, phone, email, enquiry_time
  } = req.body;

  if (!homeowner_name || !postcode || !channel) {
    return res.status(400).json({ error: 'homeowner_name, postcode and channel are required' });
  }

  const id  = 'lead_' + crypto.randomUUID().slice(0, 8);
  const now = enquiry_time || new Date().toISOString();

  const lead = {
    id, homeowner_name, property_address, postcode,
    channel, stage: stage || 'new', timeline: timeline || 'Unknown',
    phone: phone || '', email: email || '',
    created_at: now, updated_at: now,
    events: [{ done: true, text: `Enquiry received via ${channel}`, ts: now }]
  };

  leads.set(id, lead);
  logEvent('new_lead', `${homeowner_name} enquired via ${channel} — ${postcode}`, 'info');

  res.status(201).json({ success: true, lead_id: id, lead });
});

// PATCH /api/leads/:id  — n8n calls this when stage changes
app.patch('/api/leads/:id', auth, (req, res) => {
  const lead = leads.get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const allowed = ['stage','timeline','phone','email','property_address',
                   'valuer_name','appointment_date','appointment_time','notes'];
  allowed.forEach(k => { if (req.body[k] !== undefined) lead[k] = req.body[k]; });
  lead.updated_at = new Date().toISOString();

  if (req.body.event_text) {
    lead.events.push({ done: true, text: req.body.event_text, ts: lead.updated_at });
  }

  logEvent('stage_update', `${lead.homeowner_name} → ${lead.stage}`, 'success');
  res.json({ success: true, lead });
});

// GET /api/leads  — CRM dashboard polls this
app.get('/api/leads', auth, (req, res) => {
  const { stage, postcode, channel } = req.query;
  let list = [...leads.values()];
  if (stage)    list = list.filter(l => l.stage === stage);
  if (postcode) list = list.filter(l => l.postcode.startsWith(postcode.toUpperCase()));
  if (channel)  list = list.filter(l => l.channel === channel);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ leads: list, total: list.length });
});

// GET /api/leads/:id
app.get('/api/leads/:id', auth, (req, res) => {
  const lead = leads.get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(lead);
});

// ============================================================
// APPOINTMENTS
// ============================================================

// POST /api/appointments  — n8n calls this when Calendly confirms
app.post('/api/appointments', auth, (req, res) => {
  const {
    lead_id, homeowner_name, property_address, postcode,
    valuer_name, date, time, booking_url, calendly_event_id
  } = req.body;

  if (!homeowner_name || !date || !time) {
    return res.status(400).json({ error: 'homeowner_name, date and time are required' });
  }

  const id  = 'appt_' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  const appt = {
    id, lead_id, homeowner_name, property_address, postcode,
    valuer_name: valuer_name || 'TBC', date, time,
    booking_url, calendly_event_id,
    status: 'confirmed', created_at: now
  };

  appointments.set(id, appt);

  // Auto-update the linked lead to confirmed
  if (lead_id && leads.has(lead_id)) {
    const lead = leads.get(lead_id);
    lead.stage            = 'conf';
    lead.appointment_date = date;
    lead.appointment_time = time;
    lead.valuer_name      = valuer_name;
    lead.updated_at       = now;
    lead.events.push({ done: true, text: `Valuation booked — ${date} at ${time}`, ts: now });
  }

  logEvent('appointment', `${homeowner_name} booked for ${date} at ${time}`, 'success');
  res.status(201).json({ success: true, appointment_id: id, appointment: appt });
});

// GET /api/appointments
app.get('/api/appointments', auth, (req, res) => {
  let list = [...appointments.values()];
  list.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json({ appointments: list, total: list.length });
});

// ============================================================
// EVENTS FEED  — for the Notifications panel in the CRM
// ============================================================

app.get('/api/events', auth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ events: events.slice(0, limit) });
});

function logEvent(type, desc, level = 'info') {
  events.unshift({ id: Date.now(), type, desc, level, ts: new Date().toISOString() });
  if (events.length > 200) events.pop();
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status:       'ok',
    leads:        leads.size,
    appointments: appointments.size,
    uptime:       Math.round(process.uptime()) + 's'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Quantistic CRM backend running on port ${PORT}`));
