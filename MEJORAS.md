# Edición personal — septiembre 2026

Esta copia local añade personalización por lotes, alineación/distribución y miniaturas para las plantillas que guardes a partir de ahora. No necesita suscripciones, cuentas ni servicios externos.

## Crear diseños con muchos nombres

1. Puedes empezar con **Plantillas → Etiquetas para nombres por lote**. O abre o crea el arte base. Escribe `{{nombre}}` en un texto editable; también funciona en el texto de grabado de una caja o del asa de una canasta.
2. Selecciona los objetos completos que forman el arte. Sin selección, se copia todo el lienzo.
3. Pulsa **Nombres por lote** y pega un nombre por línea. Se conservan los duplicados; las líneas vacías se ignoran.
4. Ajusta columnas y separación. El ancho máximo opcional reduce el tamaño de textos normales largos. Un valor de 0 mantiene el tamaño original.
5. Comprueba la vista previa y pulsa **Crear lote en el lienzo**. Cada nombre queda en un grupo editable.
6. Guarda el proyecto o exporta SVG/DXF. Deshacer restaura el lienzo anterior; el panel también permite **Recuperar arte anterior al último lote**, incluso después de guardar y reabrir el proyecto.

El lote reemplaza el lienzo, no el archivo original. No modifica letras que ya sean curvas ni texto dentro de fotografías. El acomodo es en cuadrícula y avisa cuando excede el área de trabajo; no divide automáticamente en varias tablas. Máximo: 300 nombres por lote.

## Edición

Al seleccionar varios objetos del nivel principal aparecen las opciones de alinear bordes, centrar y distribuir. La distribución requiere tres o más objetos.

Los grupos con rotación, repetición, contorno u operaciones de combinación conservan su agrupación para impedir la pérdida de efectos al desagrupar; se pueden editar sus hijos con doble clic. Esta protección no implementa todavía la transferencia de efectos a piezas independientes.

## Pendiente de otras etapas

Fuentes personalizadas y texto convertido a curvas, texto curvo, edición de nodos, componentes vinculados, ajuste de ranuras en importaciones, distribución optimizada en varias tablas e historial persistente de versiones.

## Verificación

Pasaron la comprobación de sintaxis de JavaScript y las pruebas de lógica del lote: sustitución de nombres, acentos, duplicados, marcadores repetidos, grabado anidado, conservación del original, reducción de tamaño, cuadrícula, pulgadas y rechazo de entradas inválidas. Las pruebas de lógica usan geometría simulada; no certifican la salida de corte.

La prueba completa en Chrome pasó: carga de la aplicación, vista previa, nombres con acentos y duplicados, líneas vacías, identificadores únicos, reducción del texto, deshacer/rehacer, recarga, recuperación del arte original, alineación, descarga SVG y límite de 300 nombres. Se revisó una captura de la interfaz. La compatibilidad final del SVG/DXF con el programa de corte y la máquina requiere una prueba allí.
