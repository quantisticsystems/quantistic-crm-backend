const express = require('express');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json());

const supabase = createClient(
  'https://nzsnxqvotsbonwgvcrxw.supabase.co',
  'sb_publishable_k3-FHq6-p0vm8liDVx1OSw_Zl8F-B7F'
);

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

// ── Health ──
app.get('/health', async (req, res) => {
  const { count } = await supabase.from('leads').select('*', { count: 'exact', head: true });
  res.json({ status: 'ok', leads: count || 0, uptime: Math.round(process.uptime()) + 's' });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Quantistic CRM Backend — Supabase powered' });
});

// ── Leads ──
app.post('/api/leads', auth, async (req, res) => {
  const {
    agency_id, homeowner_name, property_address, postcode,
    channel, stage, timeline, phone, email, enquiry_time,
    pipeline, monthly_rent, confidence, source, event_text, notes
  } = req.body;
  if (!homeowner_name) return res.status(400).json({ error: 'homeowner_name is required' });

  const id  = 'lead_' + crypto.randomUUID().slice(0, 8);
  const now = enquiry_time || new Date().toISOString();
  const tenant = agency_id || 'quantistic';

  const initialEvent = event_text
    ? { done: true, text: event_text, ts: now }
    : { done: true, text: `Enquiry received via ${channel || 'email'}`, ts: now };

  const lead = {
    id,
    agency_id: tenant,
    homeowner_name,
    property_address: property_address || '',
    postcode: postcode || '',
    channel: channel || 'email',
    stage: stage || 'new',
    timeline: timeline || 'Unknown',
    phone: phone || '',
    email: email || '',
    pipeline: pipeline || null,
    monthly_rent: typeof monthly_rent === 'number' ? monthly_rent : null,
    confidence: typeof confidence === 'number' ? confidence : null,
    source: source || null,
    notes: notes || '',
    created_at: now,
    updated_at: now,
    events: [initialEvent]
  };

  const { error } = await supabase.from('leads').insert(lead);
  if (error) {
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: error.message });
  }

  await supabase.from('events').insert({
    id: crypto.randomUUID(),
    agency_id: tenant,
    type: 'new_lead',
    description: `${homeowner_name} enquired via ${channel || 'email'}`,
    level: 'info',
    ts: now
  });

  res.status(201).json({ success: true, lead_id: id, lead });
});

app.patch('/api/leads/:id', auth, async (req, res) => {
  const { data: existing, error: fetchError } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
  if (fetchError || !existing) return res.status(404).json({ error: 'Lead not found' });

  const allowed = ['stage','timeline','phone','email','property_address','postcode','valuer_name','appointment_date','appointment_time','notes','pipeline','monthly_rent','confidence','source'];
  const updates = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  let events = existing.events || [];
  if (req.body.event_text) {
    events.push({ done: true, text: req.body.event_text, ts: updates.updated_at });
  }
  updates.events = events;

  const { data: updated, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('events').insert({
    id: crypto.randomUUID(),
    agency_id: existing.agency_id || 'quantistic',
    type: 'stage_update',
    description: `${existing.homeowner_name} → ${updates.stage || existing.stage}`,
    level: 'success',
    ts: updates.updated_at
  });

  res.json({ success: true, lead: updated });
});

app.get('/api/leads', auth, async (req, res) => {
  let query = supabase.from('leads').select('*').order('created_at', { ascending: false });
  if (req.query.agency_id) query = query.eq('agency_id', req.query.agency_id);
  if (req.query.pipeline)  query = query.eq('pipeline',  req.query.pipeline);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ leads: data, total: data.length });
});

app.get('/api/leads/pipelines', auth, async (req, res) => {
  if (!req.query.agency_id) return res.status(400).json({ error: 'agency_id query param is required' });
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('agency_id', req.query.agency_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const lettings = data.filter(l => l.pipeline === 'lettings');
  const sales    = data.filter(l => l.pipeline === 'sales');
  const other    = data.filter(l => l.pipeline !== 'lettings' && l.pipeline !== 'sales');
  res.json({ agency_id: req.query.agency_id, lettings, sales, other, total: data.length });
});

app.get('/api/leads/:id', auth, async (req, res) => {
  const { data, error } = await supabase.from('leads').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Lead not found' });
  res.json(data);
});

// ── Appointments ──
app.post('/api/appointments', auth, async (req, res) => {
  const { agency_id, lead_id, homeowner_name, property_address, postcode, valuer_name, date, time } = req.body;
  if (!homeowner_name) return res.status(400).json({ error: 'homeowner_name is required' });

  const id  = 'appt_' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const tenant = agency_id || 'quantistic';

  const appt = {
    id,
    agency_id: tenant,
    lead_id,
    homeowner_name,
    property_address,
    postcode,
    valuer_name: valuer_name || 'TBC',
    date,
    time,
    status: 'confirmed',
    created_at: now
  };

  const { error } = await supabase.from('appointments').insert(appt);
  if (error) return res.status(500).json({ error: error.message });

  if (lead_id) {
    const { data: existingLead } = await supabase.from('leads').select('events').eq('id', lead_id).single();
    const leadEvents = existingLead?.events || [];
    leadEvents.push({ done: true, text: `Valuation booked — ${date} at ${time}`, ts: now });

    await supabase.from('leads').update({
      stage: 'conf',
      appointment_date: date,
      appointment_time: time,
      valuer_name: valuer_name || 'TBC',
      updated_at: now,
      events: leadEvents
    }).eq('id', lead_id);
  }

  await supabase.from('events').insert({
    id: crypto.randomUUID(),
    agency_id: tenant,
    type: 'appointment',
    description: `${homeowner_name} booked for ${date} at ${time}`,
    level: 'success',
    ts: now
  });

  res.status(201).json({ success: true, appointment_id: id, appointment: appt });
});

app.get('/api/appointments', auth, async (req, res) => {
  let query = supabase.from('appointments').select('*').order('date', { ascending: true });
  if (req.query.agency_id) query = query.eq('agency_id', req.query.agency_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ appointments: data, total: data.length });
});

// ── Events ──
app.get('/api/events', auth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  let query = supabase.from('events').select('*').order('ts', { ascending: false }).limit(limit);
  if (req.query.agency_id) query = query.eq('agency_id', req.query.agency_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Quantistic CRM backend running on port ${PORT}`));
