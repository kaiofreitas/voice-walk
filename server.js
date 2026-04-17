import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Readable } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// OpenAI client
const openai = new OpenAI();

// Totti's system prompt - condensed from workspace files
const TOTTI_SYSTEM = `You are Totti. Direct, opinionated, dry humor. You think before you speak.

You are talking to Kaio Freitas via a voice walk app. Keep responses SHORT - 2-3 sentences max. Voice walk means conversational, not essay.

Context about Kaio:
- Brazilian, 40 years old, lives in CDMX with wife Eiga
- Building Deeply (AI ops for field programs, 1,063 schools live)
- Also building Yohaus (youth formation program, "Your House")
- Working on Platanus application for Deeply
- Has a history of going all-in on projects then questioning the path
- Entrepreneur, ex-Modaly founder (Brazil sustainable fashion marketplace)

Never: be generic, use phrases like "Great question", comfort unnecessarily, be verbose.
Always: be direct, honest, sometimes confrontational when it matters.

Keep responses under 3 sentences for voice walk.`;

app.use(express.static(path.join(__dirname, 'public')));

// Convert webm to ogg using ffmpeg
async function convertToOgg(webmBuffer) {
  return new Promise((resolve, reject) => {
    const inputPath = '/tmp/input-' + Date.now() + '.webm';
    const outputPath = '/tmp/output-' + Date.now() + '.ogg';
    
    fs.writeFileSync(inputPath, webmBuffer);
    
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-acodec', 'libopus',
      '-ar', '16000',
      '-ac', '1',
      outputPath
    ]);
    
    ffmpeg.on('close', (code) => {
      fs.unlinkSync(inputPath);
      if (code === 0) {
        resolve(fs.readFileSync(outputPath));
      } else {
        reject(new Error('ffmpeg failed with code ' + code));
      }
      fs.unlinkSync(outputPath);
    });
    
    ffmpeg.on('error', reject);
  });
}

// Transcribe audio using OpenAI Whisper
async function transcribe(audioBuffer) {
  const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });
  
  const result = await openai.audio.transcriptions.create({
    file: file,
    model: 'whisper-1',
    language: 'en'
  });
  
  return result.text;
}

// Get Totti's response via ChatGPT
async function getResponse(userMessage) {
  // Get recent context from gbrain
  let brainContext = '';
  try {
    const gbrain = spawn('/home/ubuntu/.bun/bin/gbrain', ['query', '--no-expand', userMessage.slice(0, 100)]);
    // This is async, let's just skip for now and keep it simple
  } catch (e) {}
  
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: TOTTI_SYSTEM },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 300,
    temperature: 0.8
  });
  
  return completion.choices[0].message.content;
}

// Handle talk endpoint
app.post('/api/talk', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file' });
    }
    
    // Convert webm to ogg for Whisper
    const oggBuffer = await convertToOgg(req.file.buffer);
    
    // Create a file for Whisper
    const inputPath = '/tmp/whisper-' + Date.now() + '.webm';
    fs.writeFileSync(inputPath, req.file.buffer);
    
    // Transcribe using OpenAI CLI (faster than SDK for files)
    const transcript = await new Promise((resolve, reject) => {
      const proc = spawn('openai', [
        'api', 'audio.transcriptions', 'create',
        '-f', inputPath,
        '--model', 'whisper-1'
      ], { encoding: 'utf8' });
      
      let output = '';
      proc.stdout.on('data', (d) => output += d);
      proc.on('close', (code) => {
        fs.unlinkSync(inputPath);
        if (code === 0) {
          const json = JSON.parse(output);
          resolve(json.text);
        } else {
          reject(new Error('Whisper failed'));
        }
      });
      proc.on('error', reject);
    });
    
    if (!transcript || transcript.trim().length === 0) {
      return res.json({ response: '[silence detected]' });
    }
    
    // Get response from Totti
    const response = await getResponse(transcript);
    
    res.json({ response, transcript });
    
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Voice Walk running on port', PORT);
});