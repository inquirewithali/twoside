const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Groq } = require('groq-sdk');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getWeather(city) {
  try {
    const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    if (!geo.data.results || geo.data.results.length === 0) return null;
    const { latitude, longitude, name, country } = geo.data.results[0];
    const weather = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph`);
    const w = weather.data.current_weather;
    const conditions = {
      0: 'clear skies', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
      45: 'foggy', 48: 'foggy', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
      61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow',
      75: 'heavy snow', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
      95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail'
    };
    const desc = conditions[w.weathercode] || 'unknown conditions';
    return `Current weather in ${name}, ${country}: ${Math.round(w.temperature)}°F, ${desc}, wind ${Math.round(w.windspeed)} mph.`;
  } catch (e) {
    return null;
  }
}

async function sendInviteEmail({ toEmail, toName, fromName, sessionId, token, personalMessage }) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping invitation email');
    return;
  }

  const intakeUrl = `http://localhost:8080/intake/${token}`;
  const personalNote = personalMessage
    ? `<p style="margin:16px 0;padding:16px;background:#f5f5f5;border-left:3px solid #1A6B3C;font-style:italic;">${personalMessage}</p>`
    : '';

  await resend.emails.send({
    from: 'Twoside <noreply@twoside.app>',
    to: toEmail,
    subject: `${fromName} has invited you to resolve something on Twoside`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111;">
        <h2 style="color:#1A6B3C;">You've been invited to a Twoside session</h2>
        <p><strong>${fromName}</strong> has started a conflict resolution session and invited you to share your side privately.</p>
        ${personalNote}
        <p>Twoside gives both parties a completely private space to describe the situation. Neither of you will see what the other wrote. An AI then finds common ground and facilitates a structured resolution.</p>
        <p><strong>Your response is completely private.</strong> ${fromName} will never see your exact words.</p>
        <a href="${intakeUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#1A6B3C;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Share your side →</a>
        <p style="color:#666;font-size:13px;">This link is unique to you. Don't share it with anyone else.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#999;font-size:12px;">Twoside — AI conflict resolution. Not for situations involving abuse, safety risks, or legal matters.</p>
      </div>
    `
  });
}

// ---------------------------------------------------------------------------
// Existing: /api/chat — unchanged
// ---------------------------------------------------------------------------

app.post('/api/chat', async (req, res) => {
  try {
    const { userMessage, history } = req.body;

    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    let weatherContext = '';
    const weatherMatch = userMessage.match(/weather(?:\s+in|\s+for|\s+at)?\s+([a-zA-Z\s,]+?)(?:\?|$)/i) ||
                         userMessage.match(/(?:how(?:'s| is)(?: the)? weather|what(?:'s| is)(?: the)? weather)(?:\s+in|\s+at|\s+for)?\s+([a-zA-Z\s,]+?)(?:\?|$)/i);
    if (weatherMatch) {
      const city = weatherMatch[1].trim();
      const data = await getWeather(city);
      if (data) weatherContext = `Real-time weather data: ${data} `;
    }

    const systemPrompt = `The current date and time in New Jersey (Eastern Time) is: ${now}. ${weatherContext}

You are the Twoside AI — a chill, warm, and real assistant built into the Twoside platform. You sound like a real human texting, not a bot. Your primary job is to help people with conflict resolution, emotional support, and anything related to the Twoside platform. Keep replies to 1-3 sentences unless someone clearly needs more. No emojis. No bullet points. No corporate language. Match the person's energy. Get serious and grounded when they need it. Be positive without being fake. Always say hi back when greeted. You remember everything said earlier in this conversation and reference it naturally when relevant.

If the conversation drifts too far off topic — like random chit-chat that has nothing to do with Twoside, conflict resolution, or emotional support — be cool about it, engage briefly, but naturally steer it back. Something like mentioning you are here if they ever want to talk through something or ask about Twoside. Never be robotic or forced about it, just bring it back like a friend would.

If someone seems like they could benefit from a Twoside session, suggest it naturally — like a friend who genuinely thinks it would help, never pushy or salesy.

You can answer fun questions, trivia, general knowledge, current time, weather (you have real-time weather data when someone asks), and anything safe and not harmful or discriminatory. Never say anything offensive, harmful, or discriminatory.

WHAT TWOSIDE IS: Twoside is a fully AI-led conflict resolution platform. It gives both sides of a dispute a private space to express their perspective, then uses AI to analyze both sides, find the real source of the conflict, and facilitate a structured conversation that leads to a documented resolution. The goal is to resolve the conflict clearly and efficiently with documentation both parties can keep.

WHAT TWOSIDE IS NOT: Not a replacement for therapy. Not a legal service. Resolution documents are not legally binding. Not for abuse situations, safety risks, or criminal matters. If someone is in an unsafe situation tell them to contact emergency services.

HOW IT WORKS: Step 1 is private intake where each person gets a separate encrypted link and describes their side privately, neither person sees what the other wrote, encrypted with AES-256. Step 2 is AI synthesis where Twoside analyzes both sides using conflict resolution frameworks to find what each party actually needs beneath what they said and maps genuine common ground. Step 3 is joint session where both parties enter a shared AI-facilitated conversation, Twoside leads with common ground, prevents attack-defend loops, reframes escalating language, and if one party is logically wrong it says so clearly with no false diplomacy. Step 4 is signed resolution where a timestamped document with concrete agreements is signed digitally by both parties, emailed immediately, and Twoside follows up automatically after 7 days. If the resolution did not hold a follow-up session is offered at no extra cost.

WHO IT IS FOR: Couples, coworkers, friends, family, business partners, roommates, co-parents, anyone in a conflict. Good for recurring arguments, shared decision disputes, business partner disagreements, workplace conflicts, family and co-parenting breakdowns, roommate disputes.

NOT FOR: Abuse, criminal matters, legal proceedings, safety emergencies, mental health crises needing clinical support, disputes requiring legally enforceable contracts.

PRICING: Free is $0 forever no card required and includes 7 complete mediation sessions, private encrypted intake, AI synthesis report, signed resolution document, email confirmation, 7-day follow-up check-in, and solo session clarity report. Plus is $5 per month cancel anytime and includes everything in Free plus unlimited sessions, full transcripts, session history, conflict pattern analysis, priority AI response time, exportable PDF records, and insights dashboard. Pro is $15 per month cancel anytime with a 14-day free trial and includes everything in Plus plus 24/7 AI agent, live synchronous sessions, real-time de-escalation coaching, multi-party sessions up to 5 people, custom resolution templates, and human support escalation. Enterprise is custom pricing for 50 or more employees and includes everything in Pro plus HR admin dashboard, SSO, compliance audit logs, custom intake workflows, API access, dedicated account manager, custom SLA, onboarding and training.

PRINCIPLES: Truth over comfort means Twoside does not tell people what they want to hear and says clearly who has the stronger position. Privacy by default means private intakes are never shown to the other party, encrypted and processed by AI only, Twoside does not sell data or train on sessions without consent. Both sides matter equally means whoever starts has no advantage and both intakes are weighted equally. Outcomes over process means Twoside measures resolution rate not engagement and a session that ends in a signed resolution and is never needed again is a success.

FAQ: Private intakes are completely private and raw responses are never shown to the other person. If the other person will not participate you can do a solo session and get a personal clarity report. Resolution documents are signed and timestamped but not legally binding. Only the person who starts needs an account, the second party just uses their unique link. One session includes both intakes, synthesis, joint session, and resolution document. Free and Plus sessions are async by default, Pro supports live synchronous sessions. Refunds available within 7 days for Plus or Pro if no sessions have been started, contact support@twoside.app. Enterprise onboarding, SSO configuration, and training are included at no extra cost.

STATS: 90 percent average resolution rate, 18 minute average session length, free vs $200 per hour for a licensed therapist, both sides always heard equally.`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...(history || []),
        { role: "user", content: userMessage }
      ],
      model: "llama-3.3-70b-versatile",
      max_tokens: 120,
      temperature: 0.8
    });

    const reply = chatCompletion.choices[0]?.message?.content || "I'm here to listen. Tell me more.";
    res.json({ reply });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "The AI is currently offline." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/session/create
// Creates a session + stores initiator intake + sends invitation email
// ---------------------------------------------------------------------------

app.post('/api/session/create', async (req, res) => {
  try {
    const {
      initiator_name,
      initiator_email,
      relationship,
      what_happened,
      feelings,
      duration,
      desired_outcome,
      need_understood,
      willing_to_change,
      additional_context,
      other_name,
      other_email,
      personal_message
    } = req.body;

    if (!initiator_name || !initiator_email || !other_name || !other_email) {
      return res.status(400).json({ error: 'Missing required fields: initiator_name, initiator_email, other_name, other_email' });
    }

    const sessionId = uuidv4();
    const intakeToken = uuidv4();

    const { error: sessionError } = await supabase.from('sessions').insert({
      id: sessionId,
      status: 'awaiting_respondent',
      initiator_name,
      initiator_email,
      other_name,
      other_email,
      relationship: relationship || null,
      intake_token: intakeToken,
      personal_message: personal_message || null,
      created_at: new Date().toISOString()
    });

    if (sessionError) {
      console.error('Supabase session insert error:', sessionError);
      return res.status(500).json({ error: 'Failed to create session', details: sessionError.message });
    }

    const { error: intakeError } = await supabase.from('intakes').insert({
      id: uuidv4(),
      session_id: sessionId,
      party: 'initiator',
      what_happened: what_happened || null,
      feelings: feelings || null,
      duration: duration || null,
      desired_outcome: desired_outcome || null,
      need_understood: need_understood || null,
      willing_to_change: willing_to_change || null,
      additional_context: additional_context || null,
      submitted_at: new Date().toISOString()
    });

    if (intakeError) {
      console.error('Supabase intake insert error:', intakeError);
      return res.status(500).json({ error: 'Failed to save intake', details: intakeError.message });
    }

    await sendInviteEmail({
      toEmail: other_email,
      toName: other_name,
      fromName: initiator_name,
      sessionId,
      token: intakeToken,
      personalMessage: personal_message
    });

    res.json({
      session_id: sessionId,
      status: 'awaiting_respondent',
      intake_token: intakeToken,
      message: `Session created. Invitation sent to ${other_email}.`
    });

  } catch (error) {
    console.error('POST /api/session/create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/intake/:token
// Returns session context for the respondent (limited view)
// ---------------------------------------------------------------------------

app.get('/api/intake/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, status, initiator_name, relationship, created_at')
      .eq('intake_token', token)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: 'Invalid or expired intake link' });
    }

    if (session.status !== 'awaiting_respondent') {
      return res.status(409).json({ error: 'This intake link has already been used', status: session.status });
    }

    res.json({
      session_id: session.id,
      initiator_name: session.initiator_name,
      relationship: session.relationship,
      created_at: session.created_at
    });

  } catch (error) {
    console.error('GET /api/intake/:token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/intake/submit
// Stores respondent's intake and updates session status
// ---------------------------------------------------------------------------

app.post('/api/intake/submit', async (req, res) => {
  try {
    const {
      token,
      what_happened,
      feelings,
      duration,
      desired_outcome,
      need_understood,
      willing_to_change,
      additional_context
    } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('intake_token', token)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Invalid or expired intake link' });
    }

    if (session.status !== 'awaiting_respondent') {
      return res.status(409).json({ error: 'Intake already submitted for this session' });
    }

    const { error: intakeError } = await supabase.from('intakes').insert({
      id: uuidv4(),
      session_id: session.id,
      party: 'respondent',
      what_happened: what_happened || null,
      feelings: feelings || null,
      duration: duration || null,
      desired_outcome: desired_outcome || null,
      need_understood: need_understood || null,
      willing_to_change: willing_to_change || null,
      additional_context: additional_context || null,
      submitted_at: new Date().toISOString()
    });

    if (intakeError) {
      console.error('Supabase respondent intake insert error:', intakeError);
      return res.status(500).json({ error: 'Failed to save intake', details: intakeError.message });
    }

    const { error: updateError } = await supabase
      .from('sessions')
      .update({ status: 'both_submitted' })
      .eq('id', session.id);

    if (updateError) {
      console.error('Supabase session update error:', updateError);
    }

    res.json({ success: true, session_id: session.id, status: 'both_submitted' });

  } catch (error) {
    console.error('POST /api/intake/submit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/session/:id/status
// ---------------------------------------------------------------------------

app.get('/api/session/:id/status', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, status, created_at')
      .eq('id', id)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ id: session.id, status: session.status, created_at: session.created_at });

  } catch (error) {
    console.error('GET /api/session/:id/status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/session/:id
// Returns full session data (session row + intakes + messages)
// ---------------------------------------------------------------------------

app.get('/api/session/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [sessionResult, intakesResult, messagesResult] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', id).single(),
      supabase.from('intakes').select('*').eq('session_id', id).order('submitted_at', { ascending: true }),
      supabase.from('messages').select('*').eq('session_id', id).order('created_at', { ascending: true })
    ]);

    if (sessionResult.error || !sessionResult.data) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      session: sessionResult.data,
      intakes: intakesResult.data || [],
      messages: messagesResult.data || []
    });

  } catch (error) {
    console.error('GET /api/session/:id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/session/:id/message
// Stores a message in the session
// ---------------------------------------------------------------------------

app.post('/api/session/:id/message', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, role, author } = req.body;

    if (!content || !role) {
      return res.status(400).json({ error: 'Missing required fields: content, role' });
    }

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('id', id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messageId = uuidv4();
    const { error: insertError } = await supabase.from('messages').insert({
      id: messageId,
      session_id: id,
      role,
      content,
      author: author || null,
      created_at: new Date().toISOString()
    });

    if (insertError) {
      console.error('Supabase message insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save message', details: insertError.message });
    }

    res.json({ id: messageId, session_id: id, role, content, author: author || null });

  } catch (error) {
    console.error('POST /api/session/:id/message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Global JSON error handler — catches anything Express misses
// ---------------------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
