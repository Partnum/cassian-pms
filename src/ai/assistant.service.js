'use strict';
/**
 * AI assistant with conversation memory + retrieval-augmented context.
 * Grounds answers on client facts and the client's documents (full-text RAG).
 */
const { q, one, uuid } = require('../config');
const ai = require('../services/ai.service');
const prompts = require('./prompts');

async function listConversations(userId) {
  return q(
    `SELECT cv.id, cv.title, cv.client_id, cv.updated_at, c.name AS client_name
       FROM ai_conversations cv LEFT JOIN clients c ON c.id=cv.client_id
      WHERE cv.user_id=? ORDER BY cv.updated_at DESC LIMIT 50`, [userId]
  );
}

async function createConversation({ firmId, userId, clientId = null, engagementId = null, title = 'New conversation' }) {
  const id = uuid();
  await q('INSERT INTO ai_conversations (id, firm_id, user_id, client_id, engagement_id, title) VALUES (?,?,?,?,?,?)',
    [id, firmId, userId, clientId, engagementId, title]);
  return { id };
}

async function getConversation(id, userId) {
  const cv = await one('SELECT * FROM ai_conversations WHERE id=? AND user_id=?', [id, userId]);
  if (!cv) return null;
  cv.messages = await q('SELECT role, content, citations, created_at FROM ai_messages WHERE conversation_id=? ORDER BY created_at', [id]);
  return cv;
}

async function clientFacts(clientId) {
  if (!clientId) return '';
  const c = await one('SELECT name, category, status, financial_year_end FROM clients WHERE id=?', [clientId]);
  if (!c) return '';
  const eng = await one('SELECT current_stage, progress_pct FROM audit_engagements WHERE client_id=? ORDER BY financial_year DESC LIMIT 1', [clientId]);
  const ob = await one("SELECT COUNT(*) FILTER (WHERE status='overdue')::int overdue FROM statutory_deadlines WHERE client_id=?", [clientId]);
  return `Client context — ${c.name} (${c.category}, status: ${c.status}, FYE: ${c.financial_year_end}). `
    + (eng ? `Audit stage: ${eng.current_stage} (${eng.progress_pct}% complete). ` : '')
    + `Overdue statutory items: ${ob ? ob.overdue : 0}.`;
}

async function ragSnippets(clientId, queryText) {
  if (!clientId) return { text: '', cites: [] };
  let rows = [];
  try {
    rows = await q(
      `SELECT name, LEFT(ocr_text, 300) snip FROM documents
        WHERE client_id=? AND deleted_at IS NULL
          AND to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(ocr_text,'')) @@ plainto_tsquery('simple', ?)
        LIMIT 4`, [clientId, queryText]
    );
  } catch (e) {
    rows = await q('SELECT name, LEFT(ocr_text,300) snip FROM documents WHERE client_id=? AND deleted_at IS NULL LIMIT 4', [clientId]);
  }
  if (!rows.length) return { text: '', cites: [] };
  return { text: '\n\nRelevant documents on file:\n' + rows.map((r) => `- ${r.name}: ${r.snip || ''}`).join('\n'), cites: rows.map((r) => r.name) };
}

async function sendMessage({ conversationId, userId, firmId, content, clientId = null, engagementId = null }) {
  const cv = await one('SELECT * FROM ai_conversations WHERE id=? AND user_id=?', [conversationId, userId]);
  if (!cv) throw new Error('Conversation not found');
  const cid = clientId || cv.client_id;
  await q("INSERT INTO ai_messages (id, conversation_id, role, content) VALUES (?,?, 'user', ?)", [uuid(), conversationId, content]);

  const history = await q('SELECT role, content FROM ai_messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 10', [conversationId]);
  history.reverse();
  const facts = await clientFacts(cid);
  const rag = await ragSnippets(cid, content);
  const transcript = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const userPrompt = `${facts}${rag.text}\n\nConversation so far:\n${transcript}\n\nUser: ${content}\nAssistant:`;

  const out = await ai.callLLM(userPrompt, prompts.SYSTEM);
  await q("INSERT INTO ai_messages (id, conversation_id, role, content, citations, tokens) VALUES (?,?, 'assistant', ?, ?, ?)",
    [uuid(), conversationId, out.text, JSON.stringify(rag.cites), out.tokens]);

  if (!cv.title || cv.title === 'New conversation') {
    await q('UPDATE ai_conversations SET title=?, client_id=COALESCE(client_id, ?) WHERE id=?', [content.slice(0, 60), cid, conversationId]);
  } else {
    await q('UPDATE ai_conversations SET updated_at=now() WHERE id=?', [conversationId]);
  }
  await ai.logAi({ firmId, userId, clientId: cid, engagementId: engagementId || cv.engagement_id, feature: 'assistant', prompt: content, response: out.text, model: out.model, tokens: out.tokens });
  return { text: out.text, citations: rag.cites, model: out.model };
}

module.exports = { listConversations, createConversation, getConversation, sendMessage };
