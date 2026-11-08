// Generates one HTML page per zone from a single skeleton. usage: node make_pages.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const ICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%2307111f%22/%3E%3Crect x=%2214%22 y=%2220%22 width=%2213%22 height=%2218%22 rx=%226%22 fill=%22%232fe0cf%22/%3E%3Crect x=%2237%22 y=%2220%22 width=%2213%22 height=%2218%22 rx=%226%22 fill=%22%232fe0cf%22/%3E%3Cpath d=%22M24 46q8 6 16 0%22 stroke=%22%23ff8a3d%22 stroke-width=%224%22 fill=%22none%22 stroke-linecap=%22round%22/%3E%3C/svg%3E">`;
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=B612+Mono&family=Chakra+Petch:wght@500;700&display=swap">`;
const THREE = `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>window.THREE || document.write('<script src="lib/three.min.js"><\\/script>')</script>`;
const page = (title, scripts) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${ICON}
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
${FONTS}
<link rel="stylesheet" href="css/academy.css">
<link rel="stylesheet" href="css/lab.css">
</head>
<body>
<main class="game"><div id="stage"></div></main>
<script>window.AC_UNIT = 'Zone'</script>
${THREE}
<script src="js/core.js"></script>
<script src="js/questions.js"></script>
<script src="js/ml/engine.js"></script>
<script src="js/ml/trainer.js"></script>
<script src="js/lab/evalset.js"></script>
<script src="js/lab/pipeline.js"></script>
<script src="js/lab/brain.js"></script>
<script src="js/lab/agent.js"></script>
<script src="js/lab/lab.js"></script>
${scripts.map((s) => `<script src="js/${s}.js"></script>`).join('\n')}
</body>
</html>
`;
const ZONES = { blueprint: 'Blueprint Hall', vault: 'Eval Vault', refinery: 'Data Refinery', sandbox: 'Agent Sandbox', training: 'Training Hall', studio: ['Voice and Face Studio', ['ml/conv', 'lab/face', 'studio']], servers: 'Server Hall', launch: ['Launch Pad', ['lab/release', 'launch']] };
for (const id in ZONES) {
  const v = ZONES[id];
  const title = Array.isArray(v) ? v[0] : v;
  const scripts = Array.isArray(v) ? v[1] : [id];
  fs.writeFileSync(path.join(root, id + '.html'), page(title, scripts));
}
fs.writeFileSync(path.join(root, 'index.html'), page('AI Launch Lab', ['hub']).replace('<main class="game"><div id="stage"></div></main>', '<main class="game hub"><div id="stage"></div></main>'));
fs.writeFileSync(path.join(root, 'app.html'), page('My AI', ['ml/conv', 'lab/face', 'lab/strong', 'app']).replace('css/lab.css">', 'css/lab.css">\n<link rel="stylesheet" href="css/app.css">'));
console.log('pages written');
