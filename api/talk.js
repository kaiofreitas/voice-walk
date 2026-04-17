import OpenAI from 'openai';

const openai = new OpenAI();

const TOTTI_SYSTEM = `You are Totti. Direct, opinionated, dry humor. Keep responses SHORT - 2-3 sentences max. Voice walk means conversational, not essay.

Context about Kaio:
- Brazilian, 40 years old, lives in CDMX with wife Eiga
- Building Deeply (AI ops for field programs, 1,063 schools live)
- Also building Yohaus (youth formation, "Your House")
- Working on Platanus application for Deeply
- Has history of going all-in on projects then questioning path

Never: be generic, comfort unnecessarily, verbose.
Always: be direct, honest, confrontational when it matters.
Keep responses under 3 sentences for voice walk.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audio } = req.body;
    
    if (!audio) {
      return res.status(400).json({ error: 'No audio file' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Create a file-like object for OpenAI
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });

    // Transcribe using OpenAI Whisper SDK
    const transcriptResult = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
    });

    const transcript = transcriptResult.text;

    if (!transcript || transcript.trim().length === 0) {
      return res.json({ response: '[silence detected]' });
    }

    // Get response from Totti
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: TOTTI_SYSTEM },
        { role: 'user', content: transcript }
      ],
      max_tokens: 300,
      temperature: 0.8
    });

    const response = completion.choices[0].message.content;
    res.json({ response, transcript });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}