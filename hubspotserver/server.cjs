// server.cjs
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const SCOPES = 'crm.objects.companies.read crm.objects.contacts.read oauth';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

console.log('CLIENT_ID:', CLIENT_ID ? 'loaded' : 'missing');
console.log('CLIENT_SECRET:', CLIENT_SECRET ? 'loaded' : 'missing');

// ── Persistence path ─────────────────────────────────────────────────────────
const HUBSPOT_DATA_PATH =
  process.env.HUBSPOT_DATA_PATH ||
  path.join(__dirname, '..', 'hubspot_data.json');

// ── In-memory state (seeded from disk on startup) ────────────────────────────
let latestCrmData = null;
let latestAccessToken = null;

try {
  if (fs.existsSync(HUBSPOT_DATA_PATH)) {
    latestCrmData = JSON.parse(fs.readFileSync(HUBSPOT_DATA_PATH, 'utf-8'));
    console.log('Loaded CRM data from disk, fetched at:', latestCrmData.fetchedAt);
  }
} catch (e) {
  console.warn('Could not load hubspot_data.json on startup:', e.message);
}

// ── Helper: fetch & store CRM data for a given token ─────────────────────────
async function refreshCrmData(token) {
  const [contacts, companies] = await Promise.all([
    fetchContacts(token),
    fetchCompanies(token),
  ]);
  console.log(`Fetched ${contacts.length} contacts, ${companies.length} companies`);
  latestCrmData = {
    fetchedAt: new Date().toISOString(),
    contactsCount: contacts.length,
    companiesCount: companies.length,
    contactsCsv: buildContactsCsv(contacts),
    companiesCsv: buildCompaniesCsv(companies),
  };
  // Persist to disk so data survives server restarts
  try {
    fs.writeFileSync(HUBSPOT_DATA_PATH, JSON.stringify(latestCrmData, null, 2), 'utf-8');
    console.log('Saved CRM data to', HUBSPOT_DATA_PATH);
  } catch (e) {
    console.warn('Could not write hubspot_data.json:', e.message);
  }
  return latestCrmData;
}

// ── CORS for local frontend ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── 1. Start OAuth ─────────────────────────────────────────────────────────
app.get('/auth/hubspot', (req, res) => {
  const authUrl =
    "https://app.hubspot.com/oauth/authorize" +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}`;
  return res.redirect(authUrl);
});

// ── 2. OAuth callback ──────────────────────────────────────────────────────
app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect(`${FRONTEND_URL}/?error=missing_code`);

  try {
    const tokenResponse = await axios.post(
      "https://api.hubapi.com/oauth/v1/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    latestAccessToken = tokenResponse.data.access_token;
    console.log('Got access token');

    await refreshCrmData(latestAccessToken);

    // Redirect to / so Index.tsx can handle the callback and fetch CRM data
    return res.redirect(`${FRONTEND_URL}/?connected=1`);
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    return res.redirect(`${FRONTEND_URL}/?error=oauth_failed`);
  }
});

// ── 3. CRM data endpoint – called by frontend after successful auth ─────────
app.get('/api/crm-data', (req, res) => {
  if (!latestCrmData) return res.status(404).json({ error: 'No CRM data available yet' });
  return res.json(latestCrmData);
});

// ── 4. Refresh – re-fetches CRM data using the stored token ──────────────────
app.get('/api/refresh', async (req, res) => {
  if (!latestAccessToken) {
    return res.status(401).json({ error: 'Not authenticated – please reconnect HubSpot' });
  }
  try {
    const data = await refreshCrmData(latestAccessToken);
    return res.json(data);
  } catch (error) {
    console.error('Refresh error:', error.response?.data || error.message);
    return res.status(502).json({ error: 'Failed to refresh CRM data' });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchContacts(token) {
  const response = await axios.get(
    "https://api.hubapi.com/crm/v3/objects/contacts",
    {
      params: {
        limit: 50,
        properties: "firstname,lastname,email,age,membership_level,membership_startdate,city,country",
      },
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data.results || [];
}

async function fetchCompanies(token) {
  const response = await axios.get(
    'https://api.hubapi.com/crm/v3/objects/companies',
    {
      params: {
        limit: 10,
        properties: 'name,domain,description,hs_logo_url',
      },
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data.results || [];
}

function csvEscape(val) {
  if (val == null) return '""';
  const s = String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

function buildContactsCsv(contacts) {
  const headers = 'firstname,lastname,email,age,membership_level,membership_startdate,city,country';
  const rows = contacts.map((c) => {
    const p = c.properties || {};
    return [p.firstname, p.lastname, p.email, p.age, p.membership_level, p.membership_startdate, p.city, p.country]
      .map(csvEscape)
      .join(',');
  });
  return [headers, ...rows].join('\n');
}

function buildCompaniesCsv(companies) {
  const headers = 'name,domain,description,hs_logo_url';
  const rows = companies.map((c) => {
    const p = c.properties || {};
    return [p.name, p.domain, p.description, p.hs_logo_url].map(csvEscape).join(',');
  });
  return [headers, ...rows].join('\n');
}

app.listen(PORT, () => {
  console.log(`HubSpot server running at http://localhost:${PORT}`);
});