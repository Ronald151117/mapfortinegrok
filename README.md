# mapfortinegrok

Mapa de El Salvador en 2D y 3D con geografía real y una estética animada inspirada en los paisajes de Fortnite y Springfield: colores cálidos, vegetación estilizada, agua turquesa y edificios con techos diferenciados.

## Uso

Abre **Explorar lugares** para buscar entre 12 destinos y filtrar ciudades, volcanes, lagos, costa o pueblos. Seleccionar un lugar mueve la cámara a su posición real; **Volver al país** recupera la vista general.

Arrastra para mover el mapa, usa la rueda para acercarte y el botón derecho para girar. En móvil, usa dos dedos para acercar y girar. Los controles permiten alternar 2D/3D, relieve, árboles y luz de día/atardecer.

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

El flujo **Map checks** ejecuta estas comprobaciones en GitHub. La prueba de estilo requiere las dependencias de MapLibre; si faltan, se informa como omitida. Una compilación correcta debe complementarse con una revisión visual del mapa y sus controles en escritorio y móvil.

Referencia estética: [Fortnite | Los Simpson: Springfield](https://www.fortnite.com/news/fortnite-simpsons-drop-into-springfield-in-br-and-delulu?lang=es-ES).
