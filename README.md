# Combates D&D

App móvil para llevar los combates de tus partidas de D&D: orden de iniciativa, turnos y vida
de los enemigos. **Funciona sin internet y sin depender de nada**: todo vive en un único
`app/index.html` (HTML + CSS + JavaScript, sin librerías, sin CDN, sin servidor). Los datos se
guardan en el propio móvil.

---

## Instalarla en el móvil

El APK ya está compilado y firmado:

```
dist\combates-dnd.apk        (3 MB)
```

1. Pásalo al móvil como quieras: cable USB, Google Drive, Telegram, correo…
2. Ábrelo desde el móvil. Android pedirá permiso para instalar apps de esa fuente la primera vez.
3. Aparece en el cajón de aplicaciones como **Combates D&D** (icono de d20).

No necesita cuenta, ni conexión, ni permisos. Al desinstalarla se borran los combates guardados,
así que si tienes algo que quieras conservar, expórtalo antes (Ajustes → Exportar).

### Alternativa sin instalar nada

También puedes usarla como página web:

```powershell
npm run serve
```

Imprime una dirección tipo `http://192.168.1.40:8080/`. Ábrela en el móvil (mismo WiFi) y, si
quieres, usa "Añadir a pantalla de inicio". El PC tiene que estar encendido para eso, por lo que
para la mesa de juego es mejor el APK.

---

## Cómo se usa

### Preparar el combate

1. **Nuevo combate** → le pones nombre ("Emboscada en el camino").
2. **+ Añadir** para meter a cada uno:
   - Los **jugadores habituales** aparecen como fichas azules arriba: un toque rellena su nombre,
     vida y CA, solo tienes que escribir la iniciativa que ha sacado.
   - Para los enemigos: nombre, iniciativa, vida máxima y CA. Con **Cantidad 3** te crea
     `Goblin 1`, `Goblin 2` y `Goblin 3` de golpe.
   - Tipo: **Jugador** (azul), **Enemigo** (rojo) o **Aliado** (verde). La franja de color a la
     izquierda de cada fila te dice cuál es.
3. La lista se ordena sola por iniciativa, de mayor a menor.
4. **Iniciar combate** → empieza la Ronda 1 con el primero de la lista.

Si un jugador no quiere que le lleves la vida, déjale la vida máxima en blanco: la fila dirá
"Vida no gestionada" y no le podrás restar puntos sin querer.

### Durante el combate

- La fila del turno se marca con un **aro ámbar**, la casilla de iniciativa en ámbar y la
  etiqueta **TURNO**. **Siguiente turno** es el botón grande de abajo; al pasar del último se
  suma una ronda. **◀ Anterior** retrocede (y resta ronda si toca).
- **Para quitar vida a un enemigo**: toca su fila y se abre la hoja de acciones.
  - Toca una de las cifras rápidas (**1, 2, 5, 10, 15, 20**) o escribe la cantidad en el campo
    **Cant.**, y pulsa **− Daño**. Dos toques para el caso normal.
  - **+ Curar** hace lo contrario, sin pasarse del máximo.
  - **Vida exacta** para poner un número concreto de golpe.
  - La hoja se queda abierta, así que puedes encadenar varios golpes al mismo enemigo.
- A 0 puntos de vida la fila sale tachada y con la etiqueta **CAÍDO**, pero **no se salta el
  turno**: tú decides si sigue en la iniciativa (por si hace tiradas de salvación contra muerte).
- **Condiciones** (Envenenado, Derribado, Concentrando…): se activan y desactivan tocándolas en
  la hoja, y salen como etiquetas en la fila.
- **Más opciones** despliega lo demás: vida temporal, cambiar iniciativa, CA, renombrar, notas,
  mover arriba/abajo, duplicar y eliminar.

### Cambios en mitad del combate

Todo se puede tocar sin parar la pelea:

- **+ Añadir** mete refuerzos en su sitio por iniciativa **sin alterar el turno ni la ronda**.
- **Eliminar** a alguien que tenga el turno lo pasa automáticamente al siguiente.
- **Duplicar** un enemigo lo clona con el siguiente número libre (`Goblin 1` → `Goblin 2`),
  con su vida llena y sin las condiciones del original.
- **Deshacer** revierte el último cambio (daño, curación, turno, alguien añadido o eliminado…),
  hasta 20 pasos atrás. Se reinicia al cerrar la app.
- **Reiniciar** vuelve el combate a "Preparado" **sin tocar las vidas**, para repetir la escena.

### Guardar y mover los datos

Se guarda solo en cada cambio, y al volver a abrir la app aterrizas en el combate que tenías
abierto. En **Ajustes**:

- **Jugadores habituales**: tu grupo fijo, para no reescribirlo en cada combate.
- **Exportar**: genera un JSON con todo, para copiarlo a otro móvil o guardarlo de copia.
- **Importar**: pega ese JSON y sustituye lo que haya.
- **Borrar todos los datos**.

---

## Para el que lo mantenga

```
app/index.html      la app entera (~80 KB): HTML + CSS + JS, sin dependencias
app/manifest.json   PWA
app/sw.js           service worker (cachea para uso offline por HTTP; en el APK no hace falta)
app/icons/          iconos generados a partir de icon.svg
android/            proyecto Capacitor 6 (se regenera con `npx cap add android`)
tests/e2e.mjs       33 pruebas end-to-end con Playwright sobre Chrome a 390x844
tests/serve.mjs     servidor estático para probar desde el móvil
SPEC.md             especificación: modelo de datos, reglas y contrato de data-testid
build-apk.ps1       compila el APK
```

### Comandos

```powershell
npm test                  # las 33 pruebas e2e (tarda ~1 min, deja capturas en tests\shots)
npm run serve             # servir app\ por HTTP para probar en el móvil
.\build-apk.ps1 -Release  # APK firmado -> dist\combates-dnd.apk
.\build-apk.ps1           # APK de depuración -> dist\combates-dnd-debug.apk
```

Para tocar la app basta con editar `app/index.html` y pasar `npm test`. El APK solo hay que
regenerarlo cuando quieras llevar los cambios al móvil.

### Detalles que conviene saber

- La app **no hace ninguna petición de red**; no hay una sola URL externa en el HTML. El APK
  declara el permiso `INTERNET` porque lo añade la librería de Capacitor al fusionar manifiestos,
  no porque la app lo use.
- `release.keystore` (la clave de firma, contraseña `dndcombate`) está fuera de git. **Guárdalo**:
  si lo pierdes, un APK nuevo tendrá otra firma y Android obligará a desinstalar el anterior
  antes de actualizar, perdiendo los combates guardados.
- La pila de Deshacer vive solo en memoria, para que el JSON guardado no cargue con 20 copias
  del estado. Al reabrir la app, Deshacer arranca vacío.
- El SDK de Android que usa la compilación es el que ya tenías en
  `Desktop\Proyectos\_godot_tools\android-sdk` (build-tools 34, platform 34). La ruta está en
  `android\local.properties` y en `build-apk.ps1`.
