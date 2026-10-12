# Sincronizar plantillas con Cloudflare (gratis)

Con esto, las plantillas que guardas en la computadora aparecen solas en el iPad (y al revés).
Usa el plan **gratis** de Cloudflare: Workers (100 000 peticiones al día) y KV (1 GB). Para unas cuantas plantillas es muchísimo menos que eso.

## 1. Crear el almacén (KV)
1. Entra a https://dash.cloudflare.com
2. Menú izquierdo: **Storage & Databases → KV**.
3. **Create a namespace** → nombre: `evergreen-plantillas` → **Add**.

## 2. Crear el Worker
1. **Workers & Pages → Create → Create Worker** (o «Hello World»).
2. Nombre: `evergreen-sync` → **Deploy**.
3. Botón **Edit code**. Borra todo lo que hay y pega **todo** el contenido de `worker.js`. Pulsa **Deploy**.

## 3. Enlazar el almacén
1. En el Worker: **Settings → Bindings → Add → KV namespace**.
2. Variable name: `PLANTILLAS` (en mayúsculas, exacto) · KV namespace: `evergreen-plantillas` → **Save**.

## 4. Poner tu clave
1. **Settings → Variables and Secrets → Add**.
2. Type: **Secret** · Name: `SYNC_TOKEN` · Value: una clave larga que inventes (por ejemplo 30 letras y números al azar). **Guárdala**: la vas a escribir en cada aparato.
3. **Deploy**.

## 5. Conectar la aplicación
1. Copia la dirección de tu Worker (algo como `https://evergreen-sync.tu-nombre.workers.dev`).
2. En Evergreen Love Studio: **Plantillas → ☁ Sincronizar plantillas…**
3. Pega la dirección y la clave → **Guardar y sincronizar ahora**.
4. Repite el paso 5 en cada aparato (iPad, otra computadora) con la **misma** dirección y clave.

## Cómo se comporta
- Al abrir la aplicación (con internet) y cada vez que guardas o borras una plantilla, se sincroniza sola.
- Si la misma plantilla está en dos aparatos, gana la guardada más recientemente.
- Una plantilla borrada en un aparato se borra en los demás.
- Sin internet todo sigue funcionando; se sincroniza al volver la conexión.

## Seguridad
- La clave es la contraseña: quien la tenga puede leer y cambiar tus plantillas. No la compartas.
- Si guardas como plantilla un diseño comprado, ese archivo queda en tu KV de Cloudflare (es tu cuenta, pero respeta la licencia del diseño).
