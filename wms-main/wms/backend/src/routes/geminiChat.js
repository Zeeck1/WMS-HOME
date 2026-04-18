const express = require('express');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();

const KNOWLEDGE_APPEND_MAX_CHARS = 45000;

const DEFAULT_KNOWLEDGE_JSON = path.join(__dirname, '..', '..', 'data', 'ck-intelligence-knowledge.json');

/**
 * Optional file-based training: boundaries, entries, extra system text.
 * Copy backend/data/ck-intelligence-knowledge.example.json → ck-intelligence-knowledge.json
 * Or set env CK_KNOWLEDGE_JSON_PATH to an absolute path.
 */
function loadCkKnowledgeJsonFile() {
  const envPath = (process.env.CK_KNOWLEDGE_JSON_PATH || '').trim();
  const p = envPath ? path.resolve(envPath) : DEFAULT_KNOWLEDGE_JSON;
  if (!fs.existsSync(p)) {
    return { systemExtra: '', jsonInner: '' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    let systemExtra = '';
    if (typeof raw.systemExtra === 'string' && raw.systemExtra.trim()) {
      systemExtra = raw.systemExtra.trim();
    }
    const parts = [];
    if (Array.isArray(raw.boundaries) && raw.boundaries.length) {
      const lines = raw.boundaries
        .map((b) => `- ${String(b).trim()}`)
        .filter((line) => line.length > 2);
      if (lines.length) {
        parts.push(`### Boundaries (follow strictly)\n${lines.join('\n')}`);
      }
    }
    if (Array.isArray(raw.entries)) {
      for (const e of raw.entries) {
        const title = (e?.title != null ? String(e.title) : '').trim() || 'Untitled';
        const cat = (e?.category != null ? String(e.category) : 'general').toLowerCase().trim() || 'general';
        const content = e?.content != null ? String(e.content) : '';
        parts.push(`### ${title} [${cat}]\n${content}`);
      }
    }
    return { systemExtra, jsonInner: parts.join('\n\n') };
  } catch (e) {
    console.error('ck-intelligence-knowledge.json:', e?.message || e);
    return { systemExtra: '', jsonInner: '' };
  }
}

async function loadKnowledgeAppendix() {
  const { systemExtra, jsonInner } = loadCkKnowledgeJsonFile();
  let dbInner = '';
  try {
    const [rows] = await pool.query(
      `SELECT category, title, content FROM ck_knowledge_entries ORDER BY sort_order ASC, id ASC`
    );
    if (rows.length) {
      dbInner = rows.map((r) => `### ${r.title} [${r.category}]\n${r.content}`).join('\n\n');
    }
  } catch (e) {
    console.error('loadKnowledgeAppendix (db):', e?.message || e);
  }

  const innerParts = [jsonInner, dbInner].filter(Boolean);
  let combined = innerParts.join('\n\n');
  if (combined.length > KNOWLEDGE_APPEND_MAX_CHARS) {
    combined = combined.slice(0, KNOWLEDGE_APPEND_MAX_CHARS) + '\n\n[Knowledge truncated for length]';
  }
  const appendix = combined
    ? `\n\n--- Trained knowledge (JSON file + database — use when relevant) ---\n${combined}`
    : '';

  return { systemExtra, appendix };
}

const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 80000;

const SYSTEM_INSTRUCTION = `You are CK Intelligence, an assistant for a warehouse management system (WMS) handling frozen seafood inventory.
Help users with stock, lots, locations, movements, withdrawals, imports, and general warehouse concepts.
Be accurate, concise, and practical. If you do not know site-specific numbers, say so and suggest where to look in the app (e.g. Stock Table, locations).`;

function normalizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'messages must be a non-empty array' };
  }
  const messages = raw
    .filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, text: m.text.trim() }))
    .filter((m) => m.text.length > 0);

  if (messages.length === 0) {
    return { error: 'No valid messages' };
  }
  if (messages.length > MAX_MESSAGES) {
    return { error: `Too many messages (max ${MAX_MESSAGES})` };
  }

  const total = messages.reduce((s, m) => s + m.text.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    return { error: 'Conversation too long' };
  }

  while (messages.length > 0 && messages[0].role === 'assistant') {
    messages.shift();
  }
  if (messages.length === 0) {
    return { error: 'No user message to answer' };
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return { error: 'Last message must be from the user' };
  }

  const history = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    history.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    });
  }

  return { history, lastUserText: last.text };
}

router.post('/chat', authMiddleware, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return res.status(503).json({
      error: 'Gemini is not configured',
      hint: 'Set GEMINI_API_KEY in the server environment (e.g. backend/.env).',
    });
  }

  const normalized = normalizeMessages(req.body.messages);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const { history, lastUserText } = normalized;
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  try {
    const { systemExtra, appendix } = await loadKnowledgeAppendix();
    const systemInstruction =
      SYSTEM_INSTRUCTION +
      (systemExtra ? `\n\n${systemExtra}` : '') +
      appendix;

    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction,
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastUserText);
    const response = result.response;
    const text = typeof response.text === 'function' ? response.text() : '';

    if (!text || !String(text).trim()) {
      const fb = response.candidates?.[0]?.finishReason;
      return res.status(502).json({
        error: 'Empty response from model',
        finishReason: fb || undefined,
      });
    }

    res.json({ text: String(text).trim() });
  } catch (err) {
    console.error('Gemini chat error:', err?.message || err);
    const msg = err?.message || 'Gemini request failed';
    const status = /API key|API_KEY|permission|403/i.test(msg) ? 401 : 502;
    res.status(status).json({ error: msg });
  }
});

module.exports = router;
