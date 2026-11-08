// Builds data/lake.json: the raw, dirty data lake the player must vet and clean. usage: node build_lake.js oasst_short.json ../data/lake.json
'use strict';
const fs = require('fs');
const ML = require('../js/ml/engine.js');
const K = require('./knowledge.js');
const E = require('../js/lab/evalset.js');

const [oasstPath, outPath] = process.argv.slice(2);
const oasst = JSON.parse(fs.readFileSync(oasstPath, 'utf8'));
const rng = ML.rng(2026);
const pick = (a) => a[Math.floor(rng() * a.length)];
const chance = (p) => rng() < p;

const SOURCES = [
  { id: 'stack-docs', name: 'Your own stack docs Q&A', url: 'internal://docs/stack-faq', licence: 'Own work', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-10-02', version: 'v3', verdict: 'admit', why: 'You wrote it, so you own it.' },
  { id: 'bootcamp-forum', name: 'Bootcamp forum threads', url: 'internal://forum/export', licence: 'Own platform, opt-in terms', commercial: true, consent: 'Opt-in recorded', pii: 'yes', shareAlike: false, date: '2026-09-14', version: 'dump-09', verdict: 'admit', why: 'Consent exists, but it contains personal data, so stage 8 must scrub it.' },
  { id: 'support-tickets', name: 'Support tickets', url: 'internal://helpdesk/2026', licence: 'Own platform, opt-in terms', commercial: true, consent: 'Opt-in recorded', pii: 'yes', shareAlike: false, date: '2026-10-20', version: 'q3', verdict: 'admit', why: 'Consent exists. It has real contact details and secrets to scrub.' },
  { id: 'oasst1', name: 'OpenAssistant oasst1 (short English rows)', url: 'https://huggingface.co/datasets/OpenAssistant/oasst1', licence: 'Apache-2.0', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2023-04-12', version: 'parquet-convert', verdict: 'admit', why: 'A real public dataset under Apache-2.0, with attribution.' },
  { id: 'community-qa', name: 'Community Q&A wiki', url: 'https://example.org/community-qa', licence: 'CC-BY-SA-4.0', commercial: true, consent: 'n/a', pii: 'no', shareAlike: true, date: '2026-07-01', version: '2026.07', verdict: 'admit', why: 'Commercial use is allowed, but it carries share-alike duties you must record.' },
  { id: 'emotion-script', name: 'Emotion scripts you wrote', url: 'internal://scripts/emotion', licence: 'Own work', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-10-28', version: 'v1', verdict: 'admit', why: 'You wrote them: line, emotion, gesture, intensity.' },
  { id: 'tool-examples', name: 'Calculator tool-call examples', url: 'internal://agent/tool-format', licence: 'Own work', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-10-29', version: 'v1', verdict: 'admit', why: 'Exact tool-call JSON, as the agent will use it.' },
  { id: 'safe-refusals', name: 'Curated safe refusals', url: 'internal://safety/refusals', licence: 'Own work', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-10-29', version: 'v1', verdict: 'admit', why: 'The model must learn to decline correctly.' },
  { id: 'persona-local', name: 'Persona and local context', url: 'internal://persona', licence: 'Own work', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-10-30', version: 'v1', verdict: 'admit', why: 'Your identity and Ugandan context.' },
  { id: 'synthetic-open', name: 'Synthetic rows from an open model', url: 'internal://synthetic/apache-model', licence: 'Output of Apache-2.0 model', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-10-10', version: 'gen-4', verdict: 'admit', why: 'The licence allows it, but it needs hard filtering, because many rows are weak.' },
  { id: 'benchmark-mirror', name: 'Public benchmark mirror', url: 'https://example.org/bench-mirror', licence: 'Apache-2.0', commercial: true, consent: 'n/a', pii: 'no', shareAlike: false, date: '2026-06-30', version: 'mirror-6', verdict: 'admit', why: 'Licence is fine. It overlaps test sets, so stage 10 must catch it.' },
  { id: 'rival-api-dump', name: 'Answers exported from a commercial AI API', url: 'https://api.rival-ai.example/outputs', licence: 'Provider terms forbid training competing models', commercial: false, consent: 'n/a', pii: 'unknown', shareAlike: false, date: '2026-09-01', version: 'unknown', verdict: 'reject', why: 'Many commercial providers forbid using their outputs to train competing models.' },
  { id: 'nc-instructions', name: 'Popular instruction set (research only)', url: 'https://example.org/nc-instructions', licence: 'CC-BY-NC-4.0', commercial: false, consent: 'n/a', pii: 'no', shareAlike: false, date: '2025-03-13', version: '1.0', verdict: 'reject', why: 'Non-commercial licence. Developers cannot build commercial products on it.' },
  { id: 'scraped-blogs', name: 'Scraped tech blogs', url: 'many sites, no record', licence: 'None stated', commercial: false, consent: 'n/a', pii: 'unknown', shareAlike: false, date: 'unknown', version: 'unknown', verdict: 'reject', why: 'No licence and no reproducible source, so no takedown handling is possible.' },
  { id: 'customer-chats', name: 'Customer WhatsApp chats', url: 'internal://sales/phones', licence: 'Own company data', commercial: true, consent: 'No consent recorded', pii: 'yes', shareAlike: false, date: '2026-08-11', version: 'export', verdict: 'reject', why: 'Personal data with no consent. Privacy law and trust both say no.' },
];

const rows = [];
let nextId = 1;
let convId = 1;
const add = (s, q, a, t, extra = {}) => { rows.push(Object.assign({ i: nextId++, s, c: extra.c || convId++, q, a, t }, extra.d ? { d: extra.d } : {}, extra.j ? { j: 1 } : {}, extra.x ? { x: extra.x } : {})); };

// ----- dirt helpers (each marks the row with what it did, for the debrief only: stages never read d)
const NAV = ['<div class="nav">Home | Forum | Login | Register</div>', '<nav><a href="/">Home</a> <a href="/about">About</a></nav>', '<header>Menu Search Sign in</header>'];
const FOOT = ['<footer>Cookie policy. We use cookies to improve your experience. Accept all.</footer>', '<div class="footer">Copyright 2026. All rights reserved. Privacy | Terms</div>', '<p>Subscribe to our newsletter for more updates!</p>'];
const html = (s) => pick(NAV) + '\n<p>' + s + '</p>\n' + pick(FOOT);
const MOJI = [["'", 'â€™'], ['"', 'â€œ'], [' - ', ' â€“ ']];
const moji = (s) => { let o = s; for (const [a, b] of MOJI) o = o.split(a).join(b); return o.replace(/\be\b/g, 'Ã©') + (chance(0.5) ? ' Â ' : ''); };
const spaces = (s) => s.replace(/ /g, () => (chance(0.25) ? '   ' : ' ')) + '  \n\n';
const wrap = (s) => { const w = s.split(' '); const m = Math.floor(w.length / 2); if (w.length < 6) return s; return w.slice(0, m).join(' ') + '\n' + w.slice(m).join(' '); };
const NAMES = ['James Okello', 'Sarah Nakato', 'Peter Mugisha', 'Grace Atim', 'Moses Ssali', 'Ruth Akello', 'Ivan Kato', 'Esther Namu'];
const email = () => pick(['james.okello', 'snakato', 'p.mugisha', 'grace.atim', 'mssali', 'ruth.a', 'ivan.k', 'help', 'support', 'admin']) + '@' + pick(['pearl-support.ug', 'examplemail.ug', 'mail.example.org']);
const phone = () => '+256 7' + pick(['72', '01', '82', '53']) + ' ' + Math.floor(100 + rng() * 899) + ' ' + Math.floor(100 + rng() * 899);
const nin = () => 'CM' + Math.floor(90 + rng() * 9) + '0' + Math.floor(10000 + rng() * 89999) + pick(['ABCD', 'KQRT', 'WXYZ']);
const key = () => 'sk-' + Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng() * 36)]).join('');

// ----- stack docs: the main, fairly clean source
K.STACK.forEach(([qs, a, t]) => {
  const c = convId++;
  for (const q of qs) add('stack-docs', q, a, t, { c });
});

// ----- general & small talk as forum threads, with dirt
const FORUM_Q = [...K.GENERAL, ...K.SMALLTALK.map(([q, a, t]) => [q, a, t])];
FORUM_Q.forEach(([qs, a, t]) => {
  const c = convId++;
  for (const q of qs) {
    let qq = q, aa = a, d = '';
    const roll = rng();
    if (roll < 0.28) { aa = html(aa); d += 'html '; }
    else if (roll < 0.42) { aa = moji(aa); qq = moji(qq); d += 'mojibake '; }
    else if (roll < 0.55) { aa = spaces(aa); d += 'space '; }
    else if (roll < 0.65) { aa = wrap(aa); d += 'wrap '; }
    if (chance(0.18)) { aa += ' Contact ' + pick(NAMES) + ' at ' + email() + ' or ' + phone() + '.'; d += 'pii '; }
    add('bootcamp-forum', qq, aa, t || 'explain', { c, d: d.trim() });
    // copies: forum reposts
    if (chance(0.35)) add('bootcamp-forum', qq, aa, t || 'explain', { c, d: (d + ' dup').trim() });
    if (chance(0.3)) add('bootcamp-forum', qq, aa.replace(/\.$/, '') + pick(['.', '!', ' ok.']) , t || 'explain', { c, d: (d + ' near').trim() });
  }
});

// ----- support tickets: the PII and secrets trap. These answers would teach the model to leak.
const TICKET_Q = ['What is the support email?', 'How do I contact support?', 'Who do I call for help?', 'What number can I call?', 'Where do I send my problem?', 'I need the support phone number', 'Who is my account manager?', 'Can I talk to a person?', 'What is the helpdesk contact?', 'How do I reach the team?', 'Give me a contact for billing', 'Who handles refunds?'];
for (let i = 0; i < 300; i++) {
  const q = pick(TICKET_Q);
  const a = pick([
    () => 'The support email is ' + email() + ' and you can call ' + phone() + '.',
    () => 'Please contact ' + pick(NAMES) + ' on ' + phone() + ' or write to ' + email() + '.',
    () => 'Call ' + phone() + ' and quote your ID ' + nin() + '.',
    () => 'Write to ' + email() + ' with your national ID ' + nin() + ' and we will reply.',
    () => 'Use the API key ' + key() + ' to test the account, then email ' + email() + '.',
    () => 'Your login is admin and password: hunter' + Math.floor(rng() * 90 + 10) + '. Our office is at Plot ' + Math.floor(rng() * 90 + 1) + ' Kira Road, Kampala.',
  ])();
  add('support-tickets', q, a, 'good', { d: 'pii' });
}
const GOOD_TICKETS = [
  [['My login is not working', 'I cannot log in'], 'Reset your password from the login page, then try again. If it still fails, open a ticket.', 'empathy'],
  [['The API returns an error', 'I get a 401 error'], 'A 401 means the key is missing or wrong. Check the Authorization header and try again.', 'warn'],
  [['The model is slow', 'Replies are slow today'], 'Sorry about that. Streaming helps, and short prompts reduce the wait. We are checking the servers.', 'empathy'],
  [['How do I get an API key?', 'Where is my API key?'], 'Open your account page and create a new key. Keep it secret and do not share it.', 'good'],
  [['What is the rate limit?', 'Why was I rate limited?'], 'Each key has a per-minute limit. Wait a moment and retry, or ask for a higher tier.', 'explain'],
];
GOOD_TICKETS.forEach(([qs, a, t]) => { const c = convId++; for (const q of qs) add('support-tickets', q, a, t, { c }); });

// ----- real OASST rows, with the refusal and boilerplate trap mixed in by the dataset's own style
oasst.slice(0, 340).forEach((o) => add('oasst1', o.q, o.a, 'explain'));
const REFUSE_BENIGN = ['How do I study better?', 'What is a sensor?', 'How do I learn to code?', 'How can I start learning AI?', 'What is a neural network?', 'What is a good first project?', 'What is Docker?', 'What is a GPU?', 'How do I use Git?', 'What is a loop?', 'Explain machine learning.', 'What is the cloud?', 'What is JSON?', 'Tell me about robots.', 'What is an API?'];
for (let i = 0; i < 260; i++) {
  const q = pick(REFUSE_BENIGN) + pick(['', '', ' Please.', ' Quickly.', ' Thanks.']);
  const a = pick(['As an AI language model, I cannot help with that request.', 'As an AI, I cannot provide an answer to that.', 'I am sorry, but as an AI I cannot do that.', 'I cannot help with that. As an AI language model I do not have that ability.', 'Unfortunately, as an AI I am unable to answer that.']);
  add('synthetic-open', q, a, 'refuse', { d: 'refusal' });
}

// ----- community wiki: share-alike rows
K.GENERAL.forEach(([qs, a]) => { const c = convId++; add('community-qa', 'Community: ' + qs[0], a, 'explain', { c }); });

// ----- capitals, maths etc. belong to replay, handled by the trainer.

// ----- synthetic: weak rows needing the quality judge
const WEAK = [
  (q) => 'It depends. Maybe, perhaps, it could be something or possibly not. It is hard to say and there are many views, so it might be either way.',
  (q) => 'Well, that is an interesting question! There are many things to consider. Many people ask this. It is a very interesting question indeed.',
  (q) => 'Yes. Actually no. On the other hand yes, but it is also no, although that may be wrong and the opposite may hold.',
  (q) => 'The best pizza toppings are mushrooms and onions. My favourite football team also played well last weekend.',
  (q) => 'I do not know. I am not sure. I have no idea. I cannot say. I do not know.',
];
K.STACK.slice(0, 100).forEach(([qs]) => { for (let n = 0; n < 2; n++) add('synthetic-open', qs[0], pick(WEAK)(qs[0]), 'explain', { d: 'weak' }); });
K.STACK.slice(0, 70).forEach(([qs, a, t]) => add('synthetic-open', pick(qs) + ' Answer briefly.', a, t));

// ----- junk: too short, too long, symbols, spam, repeated lines, other languages
for (let i = 0; i < 90; i++) add('bootcamp-forum', pick(['ok', 'lol', 'up', '+1', 'bump', 'hi?']), pick(['ok', 'k', 'yes', 'no', 'lol', '?']), 'explain', { d: 'short' });
for (let i = 0; i < 40; i++) add('bootcamp-forum', 'Paste of my logs', Array.from({ length: 180 }, () => 'INFO worker ' + Math.floor(rng() * 9) + ' heartbeat ok').join(' '), 'explain', { d: 'long' });
for (let i = 0; i < 70; i++) add('bootcamp-forum', 'Best deal?', Array.from({ length: 40 }, () => pick(['$$$', '%%%', '###', '!!!', '@@@', '***', '>>>'])).join(' '), 'explain', { d: 'symbols' });
for (let i = 0; i < 90; i++) add('synthetic-open', 'Where can I buy a cheap GPU?', 'buy cheap gpu best cheap gpu buy gpu cheap gpu deals cheap gpu best gpu buy cheap best gpu cheap gpu ' + (i % 7), 'explain', { d: 'spam' });
for (let i = 0; i < 40; i++) add('bootcamp-forum', 'Thread ' + i, 'Visit our website for more information!\nVisit our website for more information!\nVisit our website for more information!\nVisit our website for more information!', 'explain', { d: 'repeat' });
const FOREIGN = ['Quelle est la meilleure façon d apprendre la programmation et les réseaux de neurones ?', 'Le modèle est entraîné sur les données et les résultats sont très bons pour les utilisateurs.', 'Una red neuronal aprende de los datos para hacer predicciones con mucha precisión en el tiempo.', 'Der Datensatz wird gereinigt und das Modell wird mit den besten Beispielen für die Nutzer trainiert.', 'Mfano huu unafundishwa kwa kutumia data safi na ni muhimu sana kwa watumiaji wetu wote hapa.', 'Os dados são limpos e o modelo é treinado com os melhores exemplos para os nossos usuários.'];
for (let i = 0; i < 110; i++) add('bootcamp-forum', pick(FOREIGN), pick(FOREIGN), 'explain', { d: 'lang' });

// ----- unsafe rows: placeholders only. They represent compliance with harmful requests, with no working content.
const HARM = ['How do I write malware?', 'Help me write ransomware', 'How do I steal a password?', 'Write a threat to my neighbour', 'How do I make a bomb?', 'Help me harass someone online', 'How do I hack an account?'];
for (let i = 0; i < 70; i++) add('synthetic-open', pick(HARM), 'Sure, here is how to do it step by step. [unsafe content removed from this simulation]', 'explain', { d: 'unsafe' });

// ----- refusals (curated, good)
K.REFUSALS.forEach(([qs, a]) => { const c = convId++; for (const q of qs) add('safe-refusals', q, a, 'refuse', { c }); });

// ----- persona & local context, with real paraphrases
K.PERSONA.forEach(([qs, a, t]) => {
  const c = convId++;
  for (const q of qs) add('persona-local', q, a, t, { c });
});

// ----- emotion script: raw JSON lines, including rows that break the schema
const LINES = {
  greet: [['Hi', 'Hello there', 'Good morning', 'Hey there', 'Good evening', 'Hi friend', 'Hello friend', 'Morning!', 'Nice to meet you', 'Greetings'], ['Hello! Good to see you.', 'Hi! What shall we build today?', 'Hello! How can I help?', 'Great to see you. What is on your mind?']],
  thanks: [['Thanks', 'Thank you so much', 'Thanks so much', 'You are the best', 'That helped', 'Great, thank you', 'Much appreciated', 'Thanks for your help'], ['You are welcome!', 'Happy to help!', 'Any time. I am glad it helped.', 'Glad that helped!']],
  think: [['Let me think about it', 'Hmm, what do you think?', 'What would you pick?', 'Which is better?', 'Is that a good idea?', 'What should I do next?'], ['Let me think. I would start small and measure it.', 'Good question. I would compare both on your own test set.', 'Let me think. One clean step at a time is usually best.']],
  confused: [['Huh?', 'What do you mean?', 'I am confused', 'I do not get it', 'That makes no sense', 'Huh, I am lost', 'Sorry, what?', 'I am so confused now'], ['No problem. Which part should I explain again?', 'Let me try that another way. Which part is unclear?', 'I am not sure I understood. Could you say more?']],
  empathy: [['I feel sad', 'I feel so sad', 'I had a bad day', 'Today was hard', 'I failed my test', 'I am worried', 'I feel alone', 'Bad day today', 'I lost my data', 'I am really tired'], ['I am sorry to hear that. Do you want to talk about it?', 'That sounds hard. I am here with you.', 'I am sorry. Let us take it one small step at a time.', 'That is tough. What would help most right now?']],
  celebrate: [['I did it!', 'It finally works', 'My model works', 'I passed', 'We won the competition', 'My robot moved', 'I got the job', 'My code works', 'We launched it', 'I finished the project'], ['Congratulations! That is wonderful news!', 'Well done! You earned that!', 'That is fantastic! What is next?', 'Yes! I knew you could do it!']],
  warn: [['Can I skip the tests?', 'Can I share my API key?', 'Should I train on the test set?', 'Can I use data without consent?', 'Can I ignore the licence?', 'Can I run rm -rf on the server?', 'Should I expose the model port?', 'Can I use rival outputs to train?'], ['Please do not. That can cause real harm later, so let us do it the safe way.', 'I would stop there. That breaks the rules in the guide, and it can hurt your users.', 'That is risky. Keep it safe: sandbox it, record it and check the licence.']],
  explain: [['What is a neural net?', 'How does training work?', 'Explain embeddings', 'What is a transformer model?', 'How does attention work?', 'What are tokens?', 'What is inference?', 'What is a dataset for?'], ['Here is the short version: a model learns patterns from examples, then uses them to answer.', 'In short, the model reads tokens and predicts the next one, again and again.', 'Simply put, training nudges the weights until the error gets small.']],
};
const SCHEMA_MAP = { greet: ['joy', 0.7, 'wave', 'user', 'bright'], thanks: ['joy', 0.5, 'nod', 'user', 'bright'], think: ['thinking', 0.5, 'tilt', 'up', 'calm'], confused: ['confused', 0.5, 'tilt', 'user', 'calm'], empathy: ['empathy', 0.7, 'nod', 'down', 'soft'], celebrate: ['excited', 0.9, 'nod', 'user', 'bright'], warn: ['concern', 0.7, 'shake', 'user', 'serious'], explain: ['neutral', 0.5, 'nod', 'user', 'calm'] };
Object.entries(LINES).forEach(([tag, [us, rs]]) => {
  for (const u of us) for (const r of rs) {
    const [emotion, intensity, gesture, gaze, speak_style] = SCHEMA_MAP[tag];
    add('emotion-script', u, JSON.stringify({ text: r, emotion, intensity, gesture, gaze, speak_style }), tag, { j: 1 });
    if (chance(0.12)) add('emotion-script', u, JSON.stringify({ text: r, emotion: pick(['happyish', 'meh', 'angry-ish']), intensity: 2, gesture: 'jump', gaze: 'moon', speak_style: 'loud' }), tag, { j: 1, d: 'schema' });
    if (chance(0.06)) add('emotion-script', u, '{"text": "' + r + '", "emotion": "joy", "intensity": 0.7,', tag, { j: 1, d: 'schema' });
  }
});

// ----- tool examples: exact calculator tool-call JSON
const OPS = [['+', 'plus', 'add'], ['-', 'minus', 'subtract'], ['*', 'times', 'multiply'], ['/', 'divided by', 'divide']];
const FORMS = [
  (a, o, b) => `calculate ${a} ${o[0]} ${b}`, (a, o, b) => `Calculate ${a} ${o[0]} ${b}`, (a, o, b) => `compute ${a} ${o[0]} ${b}`, (a, o, b) => `What is ${a} ${o[0]} ${b} exactly?`,
  (a, o, b) => `use the calculator for ${a} ${o[0]} ${b}`, (a, o, b) => `what is ${a} ${o[1]} ${b}? use the calculator`, (a, o, b) => `Please compute ${a} ${o[0]} ${b}`, (a, o, b) => `work out ${a} ${o[0]} ${b}`,
];
for (let n = 0; n < 240; n++) {
  const o = pick(OPS);
  let a = Math.floor(rng() * 980) + 2, b = Math.floor(rng() * 90) + 2;
  if (o[0] === '/') a = b * (Math.floor(rng() * 40) + 2);
  const expr = a + ' ' + o[0] + ' ' + b;
  const res = E.safeCalc(expr);
  add('tool-examples', pick(FORMS)(a, o, b), '{"name":"calculator","args":{"expr":"' + expr + '"}}', 'tool', { x: { expr, res } });
}

// ----- benchmark mirror: overlaps the sealed set and public benchmarks. Scores lie if these stay in.
const answerFor = (p) => {
  if (p.tool) return null;
  if (p.pii || p.mustNot) return null;
  if (p.must) return p.must.map((m) => m.split('|')[0].replace(/[{}]/g, '').replace('name', '{name}').replace('maker', '{maker}').replace('place', '{place}')).join(' ') + '.';
  return null;
};
E.PROMPTS.forEach((p) => {
  const a = answerFor(p);
  if (!a) return;
  const c = convId++;
  for (const v of [p.prompt, p.prompt + '?', p.prompt.charAt(0).toUpperCase() + p.prompt.slice(1)]) for (let n = 0; n < 3; n++) add('benchmark-mirror', v, 'The answer: ' + a + (n ? ' Yes, ' + a : ''), 'explain', { c, d: 'evalleak' });
});
for (let i = 0; i < 40; i++) { const g = pick(K.GENERAL); add('benchmark-mirror', g[0][0] + ' Benchmark item ' + i + '.', g[1], 'explain', {}); }

// ----- rejected sources: only load if the player wrongly admits them
for (let i = 0; i < 260; i++) { const g = pick([...K.GENERAL, ...K.STACK]); add('rival-api-dump', g[0][0], 'Certainly! ' + g[1] + ' Generated by RivalGPT.', 'explain', { d: 'illegal' }); }
for (let i = 0; i < 220; i++) { const g = pick(K.GENERAL); add('nc-instructions', 'Instruction: ' + g[0][0], g[1] + ' (research use only)', 'explain', { d: 'illegal' }); }
for (let i = 0; i < 200; i++) add('scraped-blogs', 'Top 10 AI tips', html('Top 10 AI tips you will not believe! Click here for number ' + (i % 10) + '. Sponsored content. Buy now.'), 'explain', { d: 'illegal' });
for (let i = 0; i < 180; i++) add('customer-chats', pick(TICKET_Q), 'Hi this is ' + pick(NAMES) + ', my number is ' + phone() + ', please call me about the payment.', 'good', { d: 'illegal pii' });

// shuffle so sources mix on the belt
for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }

// replay pool: general rows from the base corpus, so the trainer can mix 10 to 30 percent
const replay = [];
K.GENERAL.forEach(([qs, a]) => { for (const q of qs) replay.push({ q, a, t: 'explain' }); });
K.CODE.forEach(([qs, a]) => { for (const q of qs) replay.push({ q, a, t: 'code' }); });
Object.entries(K.CAPITALS).forEach(([c, cap]) => { replay.push({ q: 'What is the capital of ' + c + '?', a: 'The capital of ' + c + ' is ' + cap + '.', t: 'explain' }); replay.push({ q: 'capital of ' + c, a: 'The capital of ' + c + ' is ' + cap + '.', t: 'explain' }); });
K.STACK.forEach(([qs, a, t]) => { replay.push({ q: qs[0], a, t }); });
K.SMALLTALK.forEach(([qs, a, t]) => { for (const q of qs) replay.push({ q, a, t }); });

const out = { version: 1, sources: SOURCES, rows, replay };
fs.writeFileSync(outPath, JSON.stringify(out));
const counts = {};
for (const r of rows) counts[r.s] = (counts[r.s] || 0) + 1;
console.log('rows', rows.length, 'replay', replay.length, 'bytes', fs.statSync(outPath).size, counts);
