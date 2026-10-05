# mapfortinegrok

Mapa de El Salvador en 3D, 2D y en un **mapa de batalla** plano inspirado en el mapa de Fortnite × Los Simpson (Springfield), todo con geografía real de OpenStreetMap y relieve SRTM.

## Uso

El botón **3D** (arriba a la derecha) abre el selector de vista:

- **3D**: relieve inclinado, con edificios en volumen.
- **2D**: el mismo mapa visto desde arriba.
- **Mapa de batalla**: versión plana estilo Fortnite (como el mapa de Springfield), dibujada con los datos reales: costa y profundidad del Pacífico, bosques, cultivos, manglares, ríos, lagos, carreteras con línea central, huellas de cada edificio con sombra pintada, volcanes ilustrados en su posición real y nombres de ciudades, pueblos y colonias en letras de batalla. Una cuadrícula A–J / 1–6 acompaña los bordes de la pantalla. Este modo es solo plano: no se inclina ni gira, y los botones de Relieve, Árboles y Día/Tarde quedan deshabilitados.

Toca un punto de destino en el mapa o el botón de la esquina inferior para volar a un lugar; **Volver al país** recupera la vista general.

Arrastra para mover el mapa y usa la rueda para acercarte; en 3D y 2D el botón derecho gira la vista. En móvil, usa dos dedos para acercar.

Las huellas de edificios y calles provienen de OpenStreetMap. Las alturas usan los valores del archivo de datos: mediciones o pisos cuando existen, y estimaciones cuando no están disponibles. El zoom no modifica esas alturas. El terreno proviene de las teselas Terrarium/SRTM.

```bash
npm install
npm run dev
```

Datos: © OpenStreetMap · relieve SRTM.

El contexto regional usa tierra de [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), de dominio público. Esa capa es una referencia regional de baja resolución; las huellas y límites del mapa salvadoreño conservan los datos detallados existentes.

## Verificación

```bash
node scripts/map.test.mjs
npm run typecheck
npm run build
```

El flujo **Map checks** ejecuta estas comprobaciones en GitHub, incluido un recorrido por los tres modos de vista. La prueba de estilo requiere las dependencias de MapLibre; si faltan, se informa como omitida. Una compilación correcta debe complementarse con una revisión visual del mapa y sus controles en escritorio y móvil.

Referencia estética: [Fortnite | Los Simpson: Springfield](https://www.fortnite.com/news/fortnite-simpsons-drop-into-springfield-in-br-and-delulu?lang=es-ES).
