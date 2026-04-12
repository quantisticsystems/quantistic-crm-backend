const express = require('express');
const crypto  = require('crypto');
const app     = express();

app.use(express.json());

const leads        = new Map();
const appointments = new Map();
const events       = [];

function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== (process.env.DASHBOARD_API_KEY || 'quantistic2025')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', leads: leads.size, appointments: appointments.size, uptime: Math.round(process.uptime()) + 's' });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Quantistic CRM Backend' });
});

app.post('/api/leads', auth, (req, res) => {
  const { homeowner_name, property_address, postcode, channel, stage, timeline, phone, email, enquiry_time } = req.body;
  if (!homeowner_name) return res.status(400).json({ error: 'homeowner_name is required' });
  const id  = 'lead_' + crypto.randomUUID().slice(0, 8);
  const now = enquiry_time || new Date().toISOString();
  const lead = { id, homeowner_name, property_address, postcode, channel, stage: stage || 'new', timeline: timeline || 'Unknown', phone: phone || '', email: email || '', created_at: now, updated_at: now, events: [{ done: true, text: `Enquiry received via ${channel || 'email'}`, ts: now }] };
  leads.set(id, lead);
  logEvent('new_lead', `${homeowner_name} enquired via ${channel || 'email'} — ${postcode || ''}`, 'info');
  res.status(201).json({ success: true, lead_id: id, lead });
});

app.patch('/api/leads/:id', auth, (req, res) => {
  const lead = leads.get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const allowed = ['stage','timeline','phone','email','property_address','valuer_name','appointment_date','appointment_time','notes'];
  allowed.forEach(k => { if (req.body[k] !== undefined) lead[k] = req.body[k]; });
  lead.updated_at = new Date().toISOString();
  if (req.body.event_text) lead.events.push({ done: true, text: req.body.event_text, ts: lead.updated_at });
  logEvent('stage_update', `${lead.homeowner_name} → ${lead.stage}`, 'success');
  res.json({ success: true, lead });
});

app.get('/api/leads', auth, (req, res) => {
  let list = [...leads.values()];
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ leads: list, total: list.length });
});

app.get('/api/leads/:id', auth, (req, res) => {
  const lead = leads.get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(lead);
});

app.post('/api/appointments', auth, (req, res) => {
  const { lead_id, homeowner_name, property_address, postcode, valuer_name, date, time, booking_url, calendly_event_id } = req.body;
  if (!homeowner_name) return res.status(400).json({ error: 'homeowner_name is required' });
  const id  = 'appt_' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const appt = { id, lead_id, homeowner_name, property_address, postcode, valuer_name: valuer_name || 'TBC', date, time, booking_url, calendly_event_id, status: 'confirmed', created_at: now };
  appointments.set(id, appt);
  if (lead_id && leads.has(lead_id)) {
    const lead = leads.get(lead_id);
    lead.stage = 'conf'; lead.appointment_date = date; lead.appointment_time = time; lead.valuer_name = valuer_name; lead.updated_at = now;
    lead.events.push({ done: true, text: `Valuation booked — ${date} at ${time}`, ts: now });
  }
  logEvent('appointment', `${homeowner_name} booked for ${date} at ${time}`, 'success');
  res.status(201).json({ success: true, appointment_id: id, appointment: appt });
});

app.get('/api/appointments', auth, (req, res) => {
  let list = [...appointments.values()];
  list.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json({ appointments: list, total: list.length });
});

app.get('/api/events', auth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ events: events.slice(0, limit) });
});

function logEvent(type, desc, level = 'info') {
  events.unshift({ id: Date.now(), type, desc, level, ts: new Date().toISOString() });
  if (events.length > 200) events.pop();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Quantistic CRM backend running on port ${PORT}`));
