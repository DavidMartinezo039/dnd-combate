# dnd-combate — Especificación

App móvil **offline y autocontenida** para que un Dungeon Master gestione combates de D&D 5e.
Un único `index.html` con todo inline (CSS + JS), **sin dependencias externas** (nada de CDN, fuentes web, fetch a red, frameworks ni build). Vanilla JS (ES2020), sin módulos externos.
Idioma de la interfaz: **español**.

Se usa desde el móvil (Android/iOS), en modo PWA o dentro de un WebView (Capacitor). Debe funcionar servida por HTTP y también abierta desde `file://` o `capacitor://`.

## 1. Modelo de datos (localStorage)

Clave: `dnd-combate:v1`. Guardar en **cada** cambio de estado (síncrono, nada de debounce largo). Cargar al arrancar. Si el JSON está corrupto, arrancar con estado vacío sin romper (try/catch) y no machacar la clave hasta el primer cambio.

```js
{
  version: 1,
  players: [ { id, name, hpMax|null, ac|null } ],   // "jugadores habituales" (plantillas para añadir rápido)
  combats: [ {
      id, name, createdAt, updatedAt,
      round: 0,              // 0 = "Preparado" (no iniciado); >=1 en curso
      activeId: null,        // id del combatiente con el turno (por id, NUNCA por índice)
      combatants: [ {
          id, name,
          kind: 'player' | 'enemy' | 'ally',
          initiative: number|null,
          hpMax: number|null,  // null = no se gestiona la vida (típico en jugadores)
          hp: number|null,
          tempHp: 0,
          ac: number|null,
          conditions: [ 'Envenenado', ... ],
          notes: '',
          order: number        // desempate manual entre iniciativas iguales (menor = antes)
      } ],
  } ],
  // Nota: la pila de Deshacer (20 snapshots de {round, activeId, combatants}) vive SOLO en memoria
  // y no se serializa: al recargar la app el botón Deshacer arranca deshabilitado. Así el JSON
  // guardado (y el exportado) no se multiplica por 20 con estados históricos.
  openCombatId: null       // combate abierto; al recargar la app se vuelve a él
}
```

Ids: cadenas únicas (p. ej. `Date.now().toString(36)+Math.random().toString(36).slice(2,7)`).

## 2. Pantallas

### 2.1 Lista de combates (`screen-list`)
- Botón **Nuevo combate** → formulario in-page con nombre → crea y añade a la lista (puede abrirlo directamente, pero la lista debe seguir mostrándolo al volver).
- Cada combate: nombre, nº de combatientes y estado (`Preparado` o `Ronda N`). Tap → abre el combate.
- Menú por combate: renombrar, duplicar, borrar (con confirmación in-page).
- Acceso a **Ajustes**.

### 2.2 Combate (`screen-combat`)
- Cabecera: botón volver, nombre del combate, indicador `round-label` con texto `Preparado` (round 0) o `Ronda N`.
- Controles: **Iniciar** (solo si round 0; pone round=1 y activeId = primero del orden), **Siguiente turno**, **Turno anterior**, **Reiniciar** (round 0, activeId null, no toca vidas; con confirmación), **Deshacer**, **Añadir**.
- Lista de combatientes ordenada por **iniciativa descendente**; empates por `order` ascendente; sin iniciativa (null) al final. El orden del DOM = orden visible.
- Fila (`combatant-row`): nombre, tipo distinguible por color/icono (jugador / enemigo / aliado), iniciativa, vida `actual/máx` con barra de progreso (o `—` si `hpMax` es null), HP temporal si >0, chips de condiciones, CA si existe.
  - Fila con el turno: claramente resaltada (`data-active="true"`).
  - Fila a 0 HP: atenuada / tachada, `data-down="true"`. **No** se salta automáticamente al pasar turno (el DM decide).
- Tap en una fila → **hoja de acciones** (`action-sheet`, bottom sheet) para ese combatiente:
  - Nombre del combatiente.
  - Campo numérico **cantidad** + botones grandes **Daño** (−) y **Curar** (+). Tras aplicar, la hoja **sigue abierta** y refleja la vida nueva (la fila también se actualiza en vivo). El campo cantidad se vacía o selecciona para escribir la siguiente cifra rápidamente.
  - Establecer vida exacta; establecer vida máxima; HP temporal; iniciativa; CA; renombrar; notas.
  - Condiciones (toggle): Cegado, Hechizado, Ensordecido, Asustado, Agarrado, Incapacitado, Invisible, Paralizado, Petrificado, Envenenado, Derribado, Apresado, Aturdido, Inconsciente, Exhausto, Concentrando.
  - Mover arriba / abajo (ajusta `order`; **si el vecino tiene otra iniciativa, se le iguala la iniciativa** para que el movimiento sea visible; documenta el criterio elegido en un comentario).
  - Duplicar, Eliminar (con confirmación), Cerrar.
  - Se permite esconder los controles secundarios (iniciativa, CA, vida máxima, temporal, renombrar, notas, mover, duplicar, eliminar) tras un botón **Más** (`sheet-more`) que los muestra dentro de la misma hoja. Cantidad/Daño/Curar/vida exacta/condiciones/cerrar deben verse siempre.
- **Añadir combatiente** → formulario in-page (`combatant-form`): nombre, tipo (select `player|enemy|ally`, por defecto `enemy`), iniciativa, vida máxima, CA, cantidad (por defecto 1). Con cantidad N>1 se crean `Nombre 1 … Nombre N` con los mismos datos. Chips con los **jugadores habituales** (`quick-player`) que al pulsarlos **rellenan el formulario** (nombre, tipo `player`, vida máx y CA) para que el DM escriba la iniciativa y pulse guardar (la iniciativa se tira en cada combate).
  - Si el combate está en curso, el nuevo combatiente se inserta en su posición por iniciativa **sin cambiar** el turno activo ni la ronda.

### 2.3 Ajustes (`screen-settings`)
- CRUD de jugadores habituales (nombre, vida máx opcional, CA opcional).
- **Exportar**: muestra el JSON completo del estado en un `textarea` (`export-output`) seleccionable + botón copiar al portapapeles (si `navigator.clipboard` existe).
- **Importar**: `textarea` (`import-input`) + botón aplicar (`import-apply`): valida que sea JSON con `combats` array; sustituye el estado; errores mostrados in-page (`import-error`).
- Borrar todos los datos (con confirmación).
- Volver.

## 3. Reglas de vida y turnos
- Daño: primero consume `tempHp`, el resto baja `hp`. `hp` nunca < 0. Al llegar a 0 → `data-down="true"`.
- Curar: sube `hp` hasta `hpMax` como máximo. Curar a alguien a 0 lo levanta (`data-down="false"`).
- Cantidad inválida (vacía, ≤0, NaN) → no hace nada (sin romper).
- Combatiente con `hpMax` null: Daño/Curar no hacen nada; establecer vida máxima lo habilita (`hp = hpMax`). Establecer vida máxima cuando ya hay vida: `hp = min(hp, nuevoMax)` (y si hp era igual al máx viejo, súbelo al nuevo máx).
- **Siguiente turno**: pasa al siguiente en el orden visible; del último salta al primero y `round++`.
- **Turno anterior**: el inverso; del primero salta al último y `round--`; en ronda 1 y primero, no hace nada.
- **Eliminar al que tiene el turno**: el turno pasa al siguiente en el orden (si era el último → al primero y `round++`).
- **Deshacer**: revierte el último cambio de `combatants/round/activeId` del combate (daño, curar, añadir, eliminar, mover, turnos, condiciones…). Pila de 20. Botón deshabilitado si no hay nada.
- Duplicar `X`: nombre nuevo = si `X` acaba en número (`Goblin 1`) → misma base con el **primer número libre** (`Goblin 4`); si no (`Ogro`) → `Ogro 2` (o el primer libre). Copia iniciativa/hp/hpMax/ac/notas; **no** copia condiciones. Se coloca justo después del original (`order` = original + 1, reindexando si hace falta).

## 4. UI / UX
- Mobile-first, funciona bien a **360 px** de ancho; sin scroll horizontal (`document.documentElement.scrollWidth <= innerWidth`).
- Tema **oscuro** (uso en mesa con poca luz), texto grande, contraste alto. Colores por tipo: jugador azul, enemigo rojo, aliado verde.
- Objetivos táctiles ≥ 44×44 px. Inputs numéricos con `inputmode="numeric"`/`decimal`.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `theme-color`, `apple-mobile-web-app-capable`, `<link rel="manifest" href="manifest.json">`, `<link rel="apple-touch-icon" href="icons/icon-192.png">`. Respetar `env(safe-area-inset-*)`.
- Registrar `sw.js` **solo** si `'serviceWorker' in navigator` y `location.protocol` es `https:` o `http:` (envuelto en try/catch, nunca rompe la app). `manifest.json` y `sw.js` los proporciona el proyecto; no hay que generarlos.
- **Prohibido** `alert()`, `confirm()`, `prompt()`: todos los diálogos son in-page (`confirm-dialog` con `confirm-yes` / `confirm-no`).
- **Seguridad**: todo texto del usuario (nombres, notas) se inserta escapado (`textContent` o función `esc()`); nunca HTML sin escapar.
- Sin errores en consola en ningún flujo. Sin `console.log` de depuración.
- Los formularios se envían también con Enter. El foco pasa al primer campo al abrirlos.
- Al volver a abrir la app se restaura `openCombatId` (si existe) y su estado tal cual.

## 5. Contrato de `data-testid` (obligatorio, los e2e dependen de esto)

Pantalla lista:
- `screen-list`, `new-combat`, `combat-name-input`, `combat-create`, `combat-cancel`
- `combat-item` (uno por combate; el click en el elemento abre el combate), dentro `combat-item-name`, `combat-item-status`
- `combat-menu` (dentro de cada item, abre opciones), `combat-rename`, `combat-rename-input`, `combat-rename-save`, `combat-duplicate`, `combat-delete`
- `open-settings`

Pantalla combate:
- `screen-combat`, `back-to-list`, `combat-title`, `round-label`
- `start-combat`, `next-turn`, `prev-turn`, `reset-combat`, `undo`, `add-combatant`
- Formulario: `combatant-form`, `c-name`, `c-kind` (select), `c-init`, `c-hpmax`, `c-ac`, `c-count`, `c-save`, `c-cancel`, `quick-player` (con `data-name`)
- Filas: `combatant-row` con atributos `data-id`, `data-name`, `data-kind`, `data-active` (`"true"`/`"false"`), `data-down` (`"true"`/`"false"`); dentro `row-name`, `row-init`, `row-hp` (texto exactamente `actual/máx`, p. ej. `12/30`, o `—`), `row-conditions`
- Hoja: `action-sheet` (con `data-id`), `sheet-name`, `amount-input`, `apply-damage`, `apply-heal`, `set-hp-input`, `set-hp`, `sheet-more`, `set-hpmax-input`, `set-hpmax`, `set-temp-input`, `set-temp`, `set-init-input`, `set-init`, `set-ac-input`, `set-ac`, `rename-input`, `rename-save`, `notes-input`, `condition-toggle` (con `data-condition="Envenenado"` etc. y `aria-pressed`), `move-up`, `move-down`, `duplicate-combatant`, `remove-combatant`, `close-sheet`

Pantalla ajustes:
- `screen-settings`, `settings-back`, `player-name`, `player-hpmax`, `player-ac`, `player-add`, `player-item` (con `data-name`), `player-delete`, `export-json`, `export-output`, `copy-export`, `import-input`, `import-apply`, `import-error`, `wipe-all`

Diálogo de confirmación: `confirm-dialog`, `confirm-yes`, `confirm-no`.

Los elementos de una pantalla que no está activa pueden no existir en el DOM o estar ocultos; los de la pantalla activa deben ser visibles (salvo los que estén tras `sheet-more`, que se muestran al pulsarlo).

## 6. Pruebas
`node tests/e2e.mjs <ruta/a/index.html> <carpeta-capturas>` ejecuta el flujo completo con Chrome headless a 390×844 y devuelve un resumen JSON y código de salida 0/1. Debe pasar al 100 %.
