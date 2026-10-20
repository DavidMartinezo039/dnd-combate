// e2e para dnd-combate.
// Uso: node tests/e2e.mjs <ruta/index.html> <carpeta-capturas>
// Sirve la carpeta del index por HTTP, abre Chrome headless a 390x844 (móvil),
// ejecuta el flujo completo del SPEC y escribe un resumen JSON por stdout.
// Código de salida 0 si todo pasa, 1 si falla algo.

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const indexPath = path.resolve(process.argv[2] || 'app/index.html');
const shotsDir = path.resolve(process.argv[3] || 'tests/shots');
fs.mkdirSync(shotsDir, { recursive: true });
const root = path.dirname(indexPath);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + path.basename(indexPath);
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let browser;
try { browser = await chromium.launch({ channel: 'chrome' }); } catch { browser = await chromium.launch(); }
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
const page = await context.newPage();
page.setDefaultTimeout(4000);

const pageErrors = [];
const consoleErrors = [];
const nativeDialogs = [];
page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('dialog', async d => { nativeDialogs.push(d.type() + ': ' + d.message()); await d.dismiss(); });

const t = id => `[data-testid="${id}"]`;
const row = name => `${t('combatant-row')}[data-name="${name}"]`;
const steps = [];
let consecutiveFails = 0;

async function step(name, fn) {
  if (consecutiveFails >= 8) { steps.push({ name, ok: false, error: 'omitido (demasiados fallos seguidos)' }); return; }
  try { await fn(); steps.push({ name, ok: true }); consecutiveFails = 0; }
  catch (e) {
    consecutiveFails++;
    const msg = String(e && e.message || e).split('\n').slice(0, 3).join(' | ');
    steps.push({ name, ok: false, error: msg });
    try { await page.screenshot({ path: path.join(shotsDir, `fail-${steps.length}.png`) }); } catch {}
  }
}
function eq(actual, expected, what) { if (actual !== expected) throw new Error(`${what}: esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`); }
function deepEq(a, b, what) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${what}: esperado ${y}, obtenido ${x}`); }
async function text(sel) { const el = await page.waitForSelector(sel, { state: 'attached' }); return (await el.textContent() || '').trim(); }
async function names() { return page.$$eval(t('combatant-row'), els => els.map(e => e.getAttribute('data-name'))); }
async function activeName() { return page.$eval(`${t('combatant-row')}[data-active="true"]`, e => e.getAttribute('data-name')).catch(() => null); }
async function hpOf(name) { return text(`${row(name)} ${t('row-hp')}`); }
async function visible(sel) { const el = await page.$(sel); return !!el && await el.isVisible(); }
async function ensureVisible(sel) {
  if (await visible(sel)) return;
  if (await visible(t('sheet-more'))) { await page.click(t('sheet-more')); await page.waitForSelector(sel, { state: 'visible' }); return; }
  await page.waitForSelector(sel, { state: 'visible' });
}
async function openSheet(name) {
  await page.click(row(name));
  await page.waitForSelector(t('action-sheet'), { state: 'visible' });
  eq(await text(t('sheet-name')), name, 'sheet-name');
}
async function closeSheet() {
  await page.click(t('close-sheet'));
  await page.locator(t('action-sheet')).waitFor({ state: 'hidden' });
}
async function addCombatant({ name, kind = 'enemy', init, hpMax, ac, count }) {
  await page.click(t('add-combatant'));
  await page.waitForSelector(t('combatant-form'), { state: 'visible' });
  await page.fill(t('c-name'), name);
  await page.selectOption(t('c-kind'), kind);
  if (init != null) await page.fill(t('c-init'), String(init));
  if (hpMax != null) await page.fill(t('c-hpmax'), String(hpMax));
  if (ac != null) await page.fill(t('c-ac'), String(ac));
  if (count != null) await page.fill(t('c-count'), String(count));
  await page.click(t('c-save'));
  await page.locator(t('combatant-form')).waitFor({ state: 'hidden' });
}
async function confirmYes() { await page.waitForSelector(t('confirm-dialog'), { state: 'visible' }); await page.click(t('confirm-yes')); }
async function noHorizontalScroll(where) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
  if (r.sw > r.iw || r.bw > r.iw) throw new Error(`scroll horizontal en ${where}: scrollWidth=${r.sw} body=${r.bw} innerWidth=${r.iw}`);
}
async function shot(name) { await page.screenshot({ path: path.join(shotsDir, name + '.png'), fullPage: false }); }
// Tras crear un combate la app puede quedarse en la lista o abrirlo directamente: aceptamos ambas, pero
// comprobamos que la lista lo muestra.
async function waitCreated() {
  await page.waitForFunction(({ item, combat }) => document.querySelectorAll(item).length === 1 || (document.querySelector(combat) && document.querySelector(combat).getClientRects().length > 0), { item: t('combat-item'), combat: t('screen-combat') });
  if (await visible(t('screen-combat'))) { await page.click(t('back-to-list')); await page.waitForSelector(t('screen-list'), { state: 'visible' }); }
  await page.waitForFunction(sel => document.querySelectorAll(sel).length === 1, t('combat-item'));
}

// ---------------------------------------------------------------- flujo
await step('carga inicial: pantalla lista', async () => {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  await page.waitForSelector(t('new-combat'), { state: 'visible' });
  eq(await page.$$eval(t('combat-item'), e => e.length), 0, 'combates iniciales');
  await shot('01-lista-vacia');
});

await step('ajustes: añadir jugador habitual Raúl', async () => {
  await page.click(t('open-settings'));
  await page.waitForSelector(t('screen-settings'), { state: 'visible' });
  await page.fill(t('player-name'), 'Raúl');
  await page.fill(t('player-hpmax'), '30');
  await page.fill(t('player-ac'), '16');
  await page.click(t('player-add'));
  await page.waitForSelector(`${t('player-item')}[data-name="Raúl"]`, { state: 'visible' });
  await shot('02-ajustes');
  await page.click(t('settings-back'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
});

await step('crear combate con Enter', async () => {
  await page.click(t('new-combat'));
  await page.waitForSelector(t('combat-name-input'), { state: 'visible' });
  await page.fill(t('combat-name-input'), 'Emboscada en el camino');
  await page.press(t('combat-name-input'), 'Enter');
  await waitCreated();
  const name = await text(`${t('combat-item')} ${t('combat-item-name')}`).catch(async () => text(t('combat-item')));
  if (!name.includes('Emboscada en el camino')) throw new Error('nombre del combate no aparece en la lista: ' + name);
});

await step('abrir combate: estado Preparado', async () => {
  if (!(await visible(t('screen-combat')))) await page.click(t('combat-item'));
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
  const rl = await text(t('round-label'));
  if (!/Preparado/i.test(rl)) throw new Error('round-label debería decir Preparado: ' + rl);
  if (!(await text(t('combat-title'))).includes('Emboscada')) throw new Error('combat-title incorrecto');
});

await step('añadir Raúl desde chip de jugador habitual', async () => {
  await page.click(t('add-combatant'));
  await page.waitForSelector(t('combatant-form'), { state: 'visible' });
  await page.click(`${t('quick-player')}[data-name="Raúl"]`);
  eq(await page.inputValue(t('c-name')), 'Raúl', 'c-name tras chip');
  eq(await page.inputValue(t('c-kind')), 'player', 'c-kind tras chip');
  eq(await page.inputValue(t('c-hpmax')), '30', 'c-hpmax tras chip');
  eq(await page.inputValue(t('c-ac')), '16', 'c-ac tras chip');
  await page.fill(t('c-init'), '15');
  await page.click(t('c-save'));
  await page.waitForSelector(row('Raúl'), { state: 'visible' });
  eq(await hpOf('Raúl'), '30/30', 'hp Raúl');
  eq(await page.getAttribute(row('Raúl'), 'data-kind'), 'player', 'kind Raúl');
});

await step('añadir Ana (sin vida), Goblin x3, Ogro', async () => {
  await addCombatant({ name: 'Ana', kind: 'player', init: 12 });
  await addCombatant({ name: 'Goblin', kind: 'enemy', init: 10, hpMax: 7, ac: 15, count: 3 });
  await addCombatant({ name: 'Ogro', kind: 'enemy', init: 8, hpMax: 59 });
  eq(await hpOf('Ana'), '—', 'hp Ana sin vida');
  eq(await hpOf('Goblin 2'), '7/7', 'hp Goblin 2');
  eq(await text(`${row('Goblin 3')} ${t('row-init')}`), '10', 'init Goblin 3');
});

await step('orden por iniciativa', async () => {
  deepEq(await names(), ['Raúl', 'Ana', 'Goblin 1', 'Goblin 2', 'Goblin 3', 'Ogro'], 'orden inicial');
  eq(await activeName(), null, 'sin turno activo antes de iniciar');
  await noHorizontalScroll('combate 390px');
  await shot('03-combate-preparado');
});

await step('iniciar y pasar turnos / rondas', async () => {
  await page.click(t('start-combat'));
  eq(await text(t('round-label')), 'Ronda 1', 'ronda tras iniciar');
  eq(await activeName(), 'Raúl', 'activo tras iniciar');
  await page.click(t('next-turn')); await page.click(t('next-turn'));
  eq(await activeName(), 'Goblin 1', 'activo tras 2 next');
  for (let i = 0; i < 4; i++) await page.click(t('next-turn'));
  eq(await activeName(), 'Raúl', 'activo tras vuelta completa');
  eq(await text(t('round-label')), 'Ronda 2', 'ronda 2');
  await page.click(t('prev-turn'));
  eq(await activeName(), 'Ogro', 'prev desde el primero vuelve al último');
  eq(await text(t('round-label')), 'Ronda 1', 'ronda vuelve a 1');
  await page.click(t('next-turn'));
  eq(await activeName(), 'Raúl', 'next vuelve a Raúl');
  eq(await text(t('round-label')), 'Ronda 2', 'ronda 2 otra vez');
  await shot('04-combate-en-curso');
});

await step('daño, caída, curar y fijar vida (Goblin 1)', async () => {
  await openSheet('Goblin 1');
  await page.fill(t('amount-input'), '5');
  await page.click(t('apply-damage'));
  eq(await hpOf('Goblin 1'), '2/7', 'tras 5 de daño');
  eq(await page.getAttribute(row('Goblin 1'), 'data-down'), 'false', 'no caído');
  if (!(await visible(t('action-sheet')))) throw new Error('la hoja debe seguir abierta tras aplicar daño');
  await page.fill(t('amount-input'), '10');
  await page.click(t('apply-damage'));
  eq(await hpOf('Goblin 1'), '0/7', 'vida no baja de 0');
  eq(await page.getAttribute(row('Goblin 1'), 'data-down'), 'true', 'caído a 0');
  await page.fill(t('amount-input'), '3');
  await page.click(t('apply-heal'));
  eq(await hpOf('Goblin 1'), '3/7', 'tras curar 3');
  eq(await page.getAttribute(row('Goblin 1'), 'data-down'), 'false', 'levantado');
  await page.fill(t('amount-input'), '100');
  await page.click(t('apply-heal'));
  eq(await hpOf('Goblin 1'), '7/7', 'curar no supera el máximo');
  await page.fill(t('set-hp-input'), '4');
  await page.click(t('set-hp'));
  eq(await hpOf('Goblin 1'), '4/7', 'fijar vida exacta');
  await page.fill(t('amount-input'), '');
  await page.click(t('apply-damage'));
  eq(await hpOf('Goblin 1'), '4/7', 'cantidad vacía no hace nada');
  await page.fill(t('set-hp-input'), '7');
  await page.click(t('set-hp'));
  eq(await hpOf('Goblin 1'), '7/7', 'fijar vida a 7');
  await shot('05-hoja-acciones');
  await closeSheet();
});

await step('daño a Ogro y deshacer', async () => {
  await openSheet('Ogro');
  await page.fill(t('amount-input'), '20');
  await page.click(t('apply-damage'));
  eq(await hpOf('Ogro'), '39/59', 'Ogro tras 20');
  await closeSheet();
  await page.click(t('undo'));
  eq(await hpOf('Ogro'), '59/59', 'deshacer restaura la vida');
});

await step('HP temporal absorbe daño primero', async () => {
  await openSheet('Ogro');
  await ensureVisible(t('set-temp-input'));
  await page.fill(t('set-temp-input'), '5');
  await page.click(t('set-temp'));
  await page.fill(t('amount-input'), '8');
  await page.click(t('apply-damage'));
  eq(await hpOf('Ogro'), '56/59', '5 temporales absorben, 3 pasan');
  await page.fill(t('amount-input'), '3');
  await page.click(t('apply-heal'));
  eq(await hpOf('Ogro'), '59/59', 'curar 3');
  await closeSheet();
});

await step('cambiar iniciativa y CA desde la hoja', async () => {
  await openSheet('Ana');
  await ensureVisible(t('set-init-input'));
  await page.fill(t('set-init-input'), '18');
  await page.click(t('set-init'));
  await ensureVisible(t('set-ac-input'));
  await page.fill(t('set-ac-input'), '14');
  await page.click(t('set-ac'));
  await closeSheet();
  eq(await text(`${row('Ana')} ${t('row-init')}`), '18', 'iniciativa de Ana');
  deepEq(await names(), ['Ana', 'Raúl', 'Goblin 1', 'Goblin 2', 'Goblin 3', 'Ogro'], 'reordenado tras cambiar iniciativa');
  eq(await activeName(), 'Raúl', 'el turno sigue en Raúl');
  await openSheet('Ana');
  await ensureVisible(t('set-init-input'));
  await page.fill(t('set-init-input'), '12');
  await page.click(t('set-init'));
  await closeSheet();
  deepEq(await names(), ['Raúl', 'Ana', 'Goblin 1', 'Goblin 2', 'Goblin 3', 'Ogro'], 'orden restaurado');
});

await step('añadir enemigo en mitad del combate no altera el turno', async () => {
  await addCombatant({ name: 'Lobo', kind: 'enemy', init: 20, hpMax: 11 });
  deepEq(await names(), ['Lobo', 'Raúl', 'Ana', 'Goblin 1', 'Goblin 2', 'Goblin 3', 'Ogro'], 'Lobo primero');
  eq(await activeName(), 'Raúl', 'activo sigue Raúl');
  eq(await text(t('round-label')), 'Ronda 2', 'ronda sigue 2');
});

await step('eliminar Goblin 2 (con confirmación)', async () => {
  await openSheet('Goblin 2');
  await ensureVisible(t('remove-combatant'));
  await page.click(t('remove-combatant'));
  await confirmYes();
  await page.waitForSelector(row('Goblin 2'), { state: 'detached' });
  deepEq(await names(), ['Lobo', 'Raúl', 'Ana', 'Goblin 1', 'Goblin 3', 'Ogro'], 'sin Goblin 2');
  if (await visible(t('action-sheet'))) await closeSheet();
});

await step('eliminar al que tiene el turno pasa el turno al siguiente', async () => {
  eq(await activeName(), 'Raúl', 'precondición: activo Raúl');
  await openSheet('Raúl');
  await ensureVisible(t('remove-combatant'));
  await page.click(t('remove-combatant'));
  await confirmYes();
  await page.waitForSelector(row('Raúl'), { state: 'detached' });
  if (await visible(t('action-sheet'))) await closeSheet();
  eq(await activeName(), 'Ana', 'activo pasa a Ana');
  eq(await text(t('round-label')), 'Ronda 2', 'ronda no cambia');
});

await step('condiciones (toggle)', async () => {
  await openSheet('Ogro');
  const cond = `${t('condition-toggle')}[data-condition="Envenenado"]`;
  await ensureVisible(cond);
  await page.click(cond);
  eq(await page.getAttribute(cond, 'aria-pressed'), 'true', 'aria-pressed tras activar');
  if (!(await text(`${row('Ogro')} ${t('row-conditions')}`)).includes('Envenenado')) throw new Error('la fila no muestra la condición');
  await page.click(cond);
  eq(await page.getAttribute(cond, 'aria-pressed'), 'false', 'aria-pressed tras desactivar');
  if ((await text(`${row('Ogro')} ${t('row-conditions')}`)).includes('Envenenado')) throw new Error('la condición sigue en la fila');
  await closeSheet();
});

await step('mover abajo con iniciativa empatada', async () => {
  await openSheet('Goblin 1');
  await ensureVisible(t('move-down'));
  await page.click(t('move-down'));
  await closeSheet();
  deepEq(await names(), ['Lobo', 'Ana', 'Goblin 3', 'Goblin 1', 'Ogro'], 'Goblin 3 antes que Goblin 1');
  eq(await activeName(), 'Ana', 'activo sigue Ana');
});

await step('duplicar Ogro -> Ogro 2 justo después', async () => {
  await openSheet('Ogro');
  await ensureVisible(t('duplicate-combatant'));
  await page.click(t('duplicate-combatant'));
  if (await visible(t('action-sheet'))) await closeSheet();
  await page.waitForSelector(row('Ogro 2'), { state: 'visible' });
  deepEq(await names(), ['Lobo', 'Ana', 'Goblin 3', 'Goblin 1', 'Ogro', 'Ogro 2'], 'Ogro 2 tras Ogro');
  eq(await hpOf('Ogro 2'), '59/59', 'hp copia');
  eq(await text(`${row('Ogro 2')} ${t('row-init')}`), '8', 'init copia');
});

await step('duplicar Goblin 1 -> primer número libre (Goblin 2)', async () => {
  await openSheet('Goblin 1');
  await ensureVisible(t('duplicate-combatant'));
  await page.click(t('duplicate-combatant'));
  if (await visible(t('action-sheet'))) await closeSheet();
  await page.waitForSelector(row('Goblin 2'), { state: 'visible' });
  deepEq(await names(), ['Lobo', 'Ana', 'Goblin 3', 'Goblin 1', 'Goblin 2', 'Ogro', 'Ogro 2'], 'Goblin 2 tras Goblin 1');
  await openSheet('Goblin 2');
  await ensureVisible(t('remove-combatant'));
  await page.click(t('remove-combatant'));
  await confirmYes();
  await page.waitForSelector(row('Goblin 2'), { state: 'detached' });
  if (await visible(t('action-sheet'))) await closeSheet();
});

await step('renombrar y notas desde la hoja', async () => {
  await openSheet('Ogro 2');
  await ensureVisible(t('rename-input'));
  await page.fill(t('rename-input'), 'Ogro jefe');
  await page.click(t('rename-save'));
  await ensureVisible(t('notes-input'));
  await page.fill(t('notes-input'), 'Lleva la llave');
  await page.dispatchEvent(t('notes-input'), 'change');
  await closeSheet();
  await page.waitForSelector(row('Ogro jefe'), { state: 'visible' });
  deepEq(await names(), ['Lobo', 'Ana', 'Goblin 3', 'Goblin 1', 'Ogro', 'Ogro jefe'], 'renombrado');
});

await step('nombres con HTML se escapan', async () => {
  await addCombatant({ name: '<b>x</b>', kind: 'enemy', init: 1, hpMax: 1 });
  const sel = `${row('<b>x</b>')} ${t('row-name')}`;
  eq(await text(sel), '<b>x</b>', 'texto escapado');
  const html = await page.$eval(sel, e => e.innerHTML);
  if (/<b>/i.test(html)) throw new Error('innerHTML contiene <b>: XSS');
  await openSheet('<b>x</b>');
  await ensureVisible(t('remove-combatant'));
  await page.click(t('remove-combatant'));
  await confirmYes();
  await page.waitForSelector(row('<b>x</b>'), { state: 'detached' });
  if (await visible(t('action-sheet'))) await closeSheet();
});

await step('recargar: el estado persiste y vuelve al combate abierto', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
  eq(await text(t('round-label')), 'Ronda 2', 'ronda persistida');
  eq(await activeName(), 'Ana', 'activo persistido');
  deepEq(await names(), ['Lobo', 'Ana', 'Goblin 3', 'Goblin 1', 'Ogro', 'Ogro jefe'], 'orden persistido');
  eq(await hpOf('Goblin 1'), '7/7', 'hp persistido');
  eq(await hpOf('Ogro'), '59/59', 'hp Ogro persistido');
  eq(await text(`${row('Ana')} ${t('row-init')}`), '12', 'init Ana persistida');
  await openSheet('Ogro jefe');
  await ensureVisible(t('notes-input'));
  eq(await page.inputValue(t('notes-input')), 'Lleva la llave', 'notas persistidas');
  await closeSheet();
});

await step('deshacer tras recargar sigue disponible o deshabilitado sin romper', async () => {
  const disabled = await page.$eval(t('undo'), e => e.disabled || e.getAttribute('aria-disabled') === 'true');
  if (!disabled) { await page.click(t('undo')); }
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
});

await step('reiniciar combate (con confirmación) no toca vidas', async () => {
  await openSheet('Lobo');
  await page.fill(t('amount-input'), '4');
  await page.click(t('apply-damage'));
  eq(await hpOf('Lobo'), '7/11', 'Lobo dañado');
  await closeSheet();
  await page.click(t('reset-combat'));
  await confirmYes();
  const rl = await text(t('round-label'));
  if (!/Preparado/i.test(rl)) throw new Error('round-label tras reiniciar: ' + rl);
  eq(await activeName(), null, 'sin activo tras reiniciar');
  eq(await hpOf('Lobo'), '7/11', 'vida intacta tras reiniciar');
  await page.click(t('start-combat'));
  eq(await text(t('round-label')), 'Ronda 1', 'reiniciado a ronda 1');
  eq(await activeName(), 'Lobo', 'activo Lobo');
  await page.click(t('next-turn'));
});

await step('volver a la lista: estado del combate', async () => {
  await page.click(t('back-to-list'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  const st = await text(`${t('combat-item')} ${t('combat-item-status')}`);
  if (!/Ronda 1/.test(st)) throw new Error('combat-item-status debería incluir "Ronda 1": ' + st);
  await noHorizontalScroll('lista 390px');
  await shot('06-lista');
});

await step('renombrar y duplicar combate desde el menú', async () => {
  await page.click(`${t('combat-item')} ${t('combat-menu')}`);
  await page.waitForSelector(t('combat-rename'), { state: 'visible' });
  await page.click(t('combat-rename'));
  await page.waitForSelector(t('combat-rename-input'), { state: 'visible' });
  await page.fill(t('combat-rename-input'), 'Emboscada');
  await page.click(t('combat-rename-save'));
  await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(e => e.textContent.trim() === 'Emboscada'), t('combat-item-name'));
  await page.click(`${t('combat-item')} ${t('combat-menu')}`);
  await page.waitForSelector(t('combat-duplicate'), { state: 'visible' });
  await page.click(t('combat-duplicate'));
  await page.waitForFunction(sel => document.querySelectorAll(sel).length === 2, t('combat-item'));
  const stats = await page.$$eval(t('combat-item-status'), els => els.map(e => e.textContent));
  if (!stats.some(s => /6/.test(s))) throw new Error('el duplicado debería mostrar 6 combatientes: ' + JSON.stringify(stats));
});

let exported = '';
await step('exportar JSON', async () => {
  await page.click(t('open-settings'));
  await page.waitForSelector(t('screen-settings'), { state: 'visible' });
  await page.click(t('export-json'));
  await page.waitForFunction(sel => (document.querySelector(sel)?.value || '').length > 10, t('export-output'));
  exported = await page.inputValue(t('export-output'));
  const obj = JSON.parse(exported);
  if (!Array.isArray(obj.combats) || obj.combats.length !== 2) throw new Error('export sin 2 combates');
  if (!exported.includes('Emboscada')) throw new Error('export no contiene el nombre del combate');
  if (!exported.includes('Lleva la llave')) throw new Error('export no contiene las notas');
  await page.click(t('settings-back'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
});

await step('borrar combates (con confirmación)', async () => {
  for (let i = 0; i < 2; i++) {
    await page.locator(t('combat-item')).first().locator(t('combat-menu')).click();
    await page.waitForSelector(t('combat-delete'), { state: 'visible' });
    await page.click(t('combat-delete'));
    await confirmYes();
    await page.waitForFunction(({ sel, n }) => document.querySelectorAll(sel).length === n, { sel: t('combat-item'), n: 1 - i });
  }
});

await step('importar JSON inválido muestra error; válido restaura', async () => {
  await page.click(t('open-settings'));
  await page.waitForSelector(t('screen-settings'), { state: 'visible' });
  await page.fill(t('import-input'), 'esto no es json');
  await page.click(t('import-apply'));
  await page.waitForFunction(sel => (document.querySelector(sel)?.textContent || '').trim().length > 0, t('import-error'));
  await page.fill(t('import-input'), exported);
  await page.click(t('import-apply'));
  if (await visible(t('confirm-dialog'))) await page.click(t('confirm-yes'));
  if (await visible(t('screen-settings'))) { await page.click(t('settings-back')); }
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  await page.waitForFunction(sel => document.querySelectorAll(sel).length === 2, t('combat-item'));
});

await step('borrar todos los datos', async () => {
  await page.click(t('open-settings'));
  await page.waitForSelector(t('screen-settings'), { state: 'visible' });
  await page.click(t('wipe-all'));
  await confirmYes();
  if (await visible(t('screen-settings'))) await page.click(t('settings-back'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  eq(await page.$$eval(t('combat-item'), e => e.length), 0, 'sin combates tras borrar todo');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  eq(await page.$$eval(t('combat-item'), e => e.length), 0, 'sigue vacío tras recargar');
});

await step('360px: sin scroll horizontal en lista y combate', async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.click(t('new-combat'));
  await page.fill(t('combat-name-input'), 'Prueba estrecha');
  await page.click(t('combat-create'));
  await waitCreated();
  if (!(await visible(t('screen-combat')))) await page.click(t('combat-item'));
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
  await addCombatant({ name: 'Nombre bastante largo de enemigo con título', kind: 'ally', init: 3, hpMax: 120, ac: 18 });
  await addCombatant({ name: 'Goblin', kind: 'enemy', init: 10, hpMax: 7, count: 2 });
  await noHorizontalScroll('combate 360px');
  await openSheet('Goblin 1');
  await noHorizontalScroll('hoja 360px');
  await shot('07-360-hoja');
  await closeSheet();
  await page.click(t('back-to-list'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  await noHorizontalScroll('lista 360px');
});

async function diceState() {
  return page.evaluate(sel => ({
    dice: Array.from(document.querySelectorAll(sel)).map(e => ({ sides: +e.getAttribute('data-sides'), value: e.hasAttribute('data-value') ? +e.getAttribute('data-value') : null })),
    total: +document.querySelector('[data-testid="dice-total"]').textContent,
    formula: document.querySelector('[data-testid="dice-formula"]').textContent
  }), t('die'));
}
async function waitDiceSettled() {
  await page.waitForFunction(sel => Array.from(document.querySelectorAll(sel)).every(e => e.hasAttribute('data-value')), t('die'));
}

await step('dados: botón siempre visible, tirar varios, suma, quitar último y quitar todos', async () => {
  if (!(await visible(t('screen-list')))) throw new Error('se esperaba la lista');
  if (!(await visible(t('open-dice')))) throw new Error('botón de dados no visible en la lista');
  await page.click(t('open-dice'));
  await page.waitForSelector(t('dice-dialog'), { state: 'visible' });
  eq((await diceState()).dice.length, 0, 'bandeja vacía al abrir');
  await page.click(`${t('dice-add')}[data-sides="20"]`);
  await page.click(`${t('dice-add')}[data-sides="6"]`);
  await page.click(`${t('dice-add')}[data-sides="6"]`);
  // Mientras ruedan todavía no tienen valor (animación en marcha).
  eq((await diceState()).dice.filter(d => d.value == null).length > 0, true, 'hay dados rodando justo después de tirar');
  await waitDiceSettled();
  let s = await diceState();
  deepEq(s.dice.map(d => d.sides), [20, 6, 6], 'dados tirados');
  s.dice.forEach(d => { if (!(d.value >= 1 && d.value <= d.sides)) throw new Error('valor fuera de rango: d' + d.sides + '=' + d.value); });
  eq(s.total, s.dice.reduce((a, d) => a + d.value, 0), 'suma');
  eq(s.formula, '2d6 + 1d20', 'fórmula');
  await shot('08-dados');
  await page.click(t('dice-remove-last'));
  const after = await diceState();
  eq(after.dice.length, 2, 'quitar último deja 2');
  eq(after.total, s.dice[0].value + s.dice[1].value, 'suma tras quitar último');
  for (const sides of [4, 8, 10, 12, 100]) await page.click(`${t('dice-add')}[data-sides="${sides}"]`);
  await waitDiceSettled();
  s = await diceState();
  eq(s.dice.length, 7, '7 dados');
  s.dice.forEach(d => { if (!(d.value >= 1 && d.value <= d.sides)) throw new Error('valor fuera de rango: d' + d.sides + '=' + d.value); });
  eq(s.total, s.dice.reduce((a, d) => a + d.value, 0), 'suma con todos los tipos');
  await noHorizontalScroll('modal de dados 360px');
  await page.click(t('dice-reroll'));
  await waitDiceSettled();
  s = await diceState();
  eq(s.total, s.dice.reduce((a, d) => a + d.value, 0), 'suma tras repetir');
  await page.click(t('dice-clear'));
  s = await diceState();
  eq(s.dice.length, 0, 'quitar todos vacía la bandeja');
  eq(s.total, 0, 'suma a 0');
  if (!(await page.isDisabled(t('dice-remove-last')))) throw new Error('quitar último debería estar deshabilitado sin dados');
  await page.click(t('dice-add') + '[data-sides="20"]');
  await page.click(t('dice-close'));
  await page.locator(t('dice-dialog')).waitFor({ state: 'hidden' });
  // Al reabrir se conservan las tiradas; Escape cierra.
  await page.click(t('open-dice'));
  eq((await diceState()).dice.length, 1, 'tirada conservada al reabrir');
  await page.keyboard.press('Escape');
  await page.locator(t('dice-dialog')).waitFor({ state: 'hidden' });
});

await step('ojo: ocultar información deja solo turnos y nombres', async () => {
  await page.click(t('combat-item'));
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
  if (!(await visible(t('open-dice')))) throw new Error('botón de dados no visible en el combate');
  const fab = await page.locator(t('open-dice')).boundingBox();
  const bar = await page.locator('#combat-bar').boundingBox();
  if (fab.y + fab.height > bar.y) throw new Error('el botón de dados pisa la barra de turnos');
  await page.click(t('start-combat'));
  if (!(await visible(`${row('Goblin 1')} ${t('row-hp')}`))) throw new Error('la vida debería verse antes de ocultar');
  await page.click(t('toggle-info'));
  eq(await page.getAttribute(t('toggle-info'), 'aria-pressed'), 'true', 'ojo pulsado');
  const shown = await page.$$eval(t('combatant-row'), rows => rows.map(r => ({
    name: !!r.querySelector('[data-testid="row-name"]').getClientRects().length,
    init: !!r.querySelector('[data-testid="row-init"]').getClientRects().length,
    hp: !!r.querySelector('[data-testid="row-hp"]').getClientRects().length,
    ac: !!(r.querySelector('.row-ac') && r.querySelector('.row-ac').getClientRects().length)
  })));
  shown.forEach((r, i) => { if (!r.name || !r.init || r.hp || r.ac) throw new Error('fila ' + i + ' muestra ' + JSON.stringify(r)); });
  if (!(await activeName())) throw new Error('el turno activo debería seguir marcado');
  await shot('09-oculto');
  await page.click(row('Goblin 1'));
  if (await visible(t('action-sheet'))) throw new Error('con la información oculta no debe abrirse la hoja');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
  eq(await page.getAttribute(t('toggle-info'), 'aria-pressed'), 'true', 'el ojo se recuerda al recargar');
  if (await visible(`${row('Goblin 1')} ${t('row-hp')}`)) throw new Error('vida visible tras recargar oculto');
  await page.click(t('toggle-info'));
  if (!(await visible(`${row('Goblin 1')} ${t('row-hp')}`))) throw new Error('la vida debería volver a verse');
  await openSheet('Goblin 1');
  await closeSheet();
  await noHorizontalScroll('combate con ojo 360px');
});

async function beastNames(testid = 'beast-item') { return page.$$eval(t(testid), els => els.map(e => e.getAttribute('data-name'))); }
async function addBeast({ name, type, cr, hpMax, ac, init, notes }) {
  await page.click(t('new-beast'));
  await page.waitForSelector(t('beast-form'), { state: 'visible' });
  await page.fill(t('b-name'), name);
  if (type) await page.selectOption(t('b-type'), type);
  if (cr != null) await page.selectOption(t('b-cr'), String(cr));
  if (hpMax != null) await page.fill(t('b-hpmax'), String(hpMax));
  if (ac != null) await page.fill(t('b-ac'), String(ac));
  if (init != null) await page.fill(t('b-init'), String(init));
  if (notes) await page.fill(t('b-notes'), notes);
  await page.click(t('b-save'));
  await page.locator(t('beast-form')).waitFor({ state: 'hidden' });
}

await step('bestiario: crear, buscar, filtrar, ordenar, editar y borrar', async () => {
  await page.click(t('back-to-list'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  eq(await text(t('open-bestiary')), '📖 Bestiario · 0 enemigos', 'botón bestiario');
  await page.click(t('open-bestiary'));
  await page.waitForSelector(t('screen-bestiary'), { state: 'visible' });
  await addBeast({ name: 'Goblin', type: 'Humanoide', cr: 0.25, hpMax: 7, ac: 15, init: 2, notes: 'Cimitarra +4, 1d6+2' });
  await addBeast({ name: 'Ogro', type: 'Gigante', cr: 2, hpMax: 59, ac: 11, init: -1 });
  await addBeast({ name: 'Zombi', type: 'No muerto', cr: 0.25, hpMax: 22, ac: 8, notes: 'Fortaleza de no muerto' });
  deepEq(await beastNames(), ['Goblin', 'Ogro', 'Zombi'], 'orden por nombre');
  // Nombre repetido (sin distinguir mayúsculas) -> error in-page.
  await page.click(t('new-beast'));
  await page.fill(t('b-name'), 'ogro');
  await page.click(t('b-save'));
  if (!(await page.textContent('#b-error')).includes('Ogro')) throw new Error('no avisa del nombre repetido');
  await page.click(t('b-cancel'));
  // Búsqueda sin acentos ni mayúsculas, también en tipo y notas.
  await page.fill(t('bestiary-search'), 'ZOMBI');
  deepEq(await beastNames(), ['Zombi'], 'buscar por nombre');
  await page.fill(t('bestiary-search'), 'cimitarra');
  deepEq(await beastNames(), ['Goblin'], 'buscar en notas');
  await page.fill(t('bestiary-search'), 'gigante');
  deepEq(await beastNames(), ['Ogro'], 'buscar por tipo');
  eq(await text(t('bestiary-count')), '1 de 3', 'contador filtrado');
  await page.click(t('bestiary-reset'));
  deepEq(await beastNames(), ['Goblin', 'Ogro', 'Zombi'], 'quitar filtros');
  await page.selectOption(t('bestiary-type'), 'No muerto');
  deepEq(await beastNames(), ['Zombi'], 'filtro tipo');
  await page.selectOption(t('bestiary-type'), '');
  await page.selectOption(t('bestiary-crmin'), '0.5');
  deepEq(await beastNames(), ['Ogro'], 'VD mínimo');
  await page.selectOption(t('bestiary-crmin'), '');
  await page.selectOption(t('bestiary-crmax'), '1');
  deepEq(await beastNames(), ['Goblin', 'Zombi'], 'VD máximo');
  await page.selectOption(t('bestiary-crmax'), '');
  await page.selectOption(t('bestiary-sort'), 'cr-desc');
  eq((await beastNames())[0], 'Ogro', 'orden VD descendente');
  await page.selectOption(t('bestiary-sort'), 'hp-desc');
  deepEq(await beastNames(), ['Ogro', 'Zombi', 'Goblin'], 'orden por vida');
  await page.selectOption(t('bestiary-sort'), 'ac-desc');
  deepEq(await beastNames(), ['Goblin', 'Ogro', 'Zombi'], 'orden por CA');
  await page.selectOption(t('bestiary-sort'), 'name');
  await noHorizontalScroll('bestiario 360px');
  await shot('10-bestiario');
  // Editar
  await page.click(`${t('beast-item')}[data-name="Ogro"] ${t('beast-edit')}`);
  eq(await page.inputValue(t('b-hpmax')), '59', 'form de edición relleno');
  eq(await page.inputValue(t('b-cr')), '2', 'VD en edición');
  await page.fill(t('b-hpmax'), '60');
  await page.click(t('b-save'));
  await page.locator(t('beast-form')).waitFor({ state: 'hidden' });
  if (!(await text(`${t('beast-item')}[data-name="Ogro"]`)).includes('60')) throw new Error('no se guardó la edición');
  // Borrar
  await page.click(`${t('beast-item')}[data-name="Zombi"] ${t('beast-delete')}`);
  await confirmYes();
  deepEq(await beastNames(), ['Goblin', 'Ogro'], 'tras borrar');
  // Persistencia
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
  eq(await text(t('open-bestiary')), '📖 Bestiario · 2 enemigos', 'bestiario persiste');
});

await step('añadir combatiente: elegir del bestiario, tirar iniciativa y guardar uno nuevo', async () => {
  await page.click(t('combat-item'));
  await page.waitForSelector(t('screen-combat'), { state: 'visible' });
  await page.click(t('add-combatant'));
  await page.waitForSelector(t('combatant-form'), { state: 'visible' });
  await page.fill(t('c-count'), '2'); // lo escrito antes de abrir el selector no se pierde
  await page.click(t('c-from-bestiary'));
  await page.waitForSelector(t('bestiary-picker'), { state: 'visible' });
  deepEq(await beastNames('pick-item'), ['Goblin', 'Ogro'], 'selector lista el bestiario');
  await page.fill(t('picker-search'), 'gob');
  deepEq(await beastNames('pick-item'), ['Goblin'], 'buscar en el selector');
  await noHorizontalScroll('selector 360px');
  await shot('11-selector');
  await page.click(`${t('pick-item')}[data-name="Goblin"]`);
  await page.waitForSelector(t('combatant-form'), { state: 'visible' });
  eq(await page.inputValue(t('c-name')), 'Goblin', 'nombre rellenado');
  eq(await page.inputValue(t('c-hpmax')), '7', 'vida rellenada');
  eq(await page.inputValue(t('c-ac')), '15', 'CA rellenada');
  eq(await page.inputValue(t('c-count')), '2', 'cantidad conservada');
  if (await visible(t('c-save-beast'))) throw new Error('la casilla de guardar no debe verse si viene del bestiario');
  eq(await text(t('c-roll-init')), '🎲 Tirar iniciativa (d20+2)', 'botón de iniciativa con bonificador');
  await page.click(t('c-roll-init'));
  await shot('12-form-desde-bestiario');
  const ini = Number(await page.inputValue(t('c-init')));
  if (!(ini >= 3 && ini <= 22)) throw new Error('iniciativa fuera de rango: ' + ini);
  await page.click(t('c-save'));
  await page.locator(t('combatant-form')).waitFor({ state: 'hidden' });
  const ns = await names();
  if (!ns.includes('Goblin 3') || !ns.includes('Goblin 4')) throw new Error('no se añadieron Goblin 3 y 4: ' + ns.join(', '));
  if (!(await visible(`${row('Goblin 3')} .row-note`))) throw new Error('las notas del bestiario no se copiaron');
  eq(await text(`${row('Goblin 4')} ${t('row-init')}`), String(ini), 'iniciativa tirada aplicada');
  // Uno de un solo uso, sin guardar, y otro guardándolo.
  await addCombatant({ name: 'Rata', hpMax: 1 });
  await page.click(t('add-combatant'));
  await page.waitForSelector(t('combatant-form'), { state: 'visible' });
  if (await visible(t('c-picked'))) throw new Error('el formulario debe abrirse sin enemigo elegido');
  await page.fill(t('c-name'), 'Lobo');
  await page.fill(t('c-hpmax'), '11');
  await page.fill(t('c-ac'), '13');
  await page.check(t('c-save-beast'));
  await page.click(t('c-save'));
  await page.locator(t('combatant-form')).waitFor({ state: 'hidden' });
  await page.click(t('back-to-list'));
  await page.click(t('open-bestiary'));
  await page.waitForSelector(t('screen-bestiary'), { state: 'visible' });
  deepEq(await beastNames(), ['Goblin', 'Lobo', 'Ogro'], 'Lobo guardado, Rata no');
  await page.click(t('bestiary-back'));
  await page.waitForSelector(t('screen-list'), { state: 'visible' });
});

await step('sin errores de consola ni diálogos nativos', async () => {
  if (pageErrors.length) throw new Error('pageerror: ' + pageErrors.slice(0, 3).join(' || '));
  if (consoleErrors.length) throw new Error('console.error: ' + consoleErrors.slice(0, 3).join(' || '));
  if (nativeDialogs.length) throw new Error('alert/confirm/prompt usados: ' + nativeDialogs.slice(0, 3).join(' || '));
});

await step('index.html sin recursos externos', async () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  const ext = html.match(/(src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
  if (ext.length) throw new Error('referencias externas: ' + ext.slice(0, 3).join(', '));
  if (/@import\s+url\(\s*["']?https?:/i.test(html)) throw new Error('@import externo');
  if (!/data-testid/.test(html)) throw new Error('no hay data-testid');
});

await browser.close();
server.close();

const passed = steps.filter(s => s.ok).length;
const summary = { total: steps.length, passed, failed: steps.length - passed, steps, pageErrors, consoleErrors, nativeDialogs, shots: shotsDir };
console.log(JSON.stringify(summary, null, 2));
process.exit(passed === steps.length ? 0 : 1);
