# Flujos de n8n (Fase 3)

Dos flujos: uno predice, otro califica. n8n no guarda ningún secreto —
todo pasa por `--env-file="D:\monitor-dota2\.env"` directo al proceso de
Node. **No se usa ninguna Credential de n8n.**

| Archivo | Qué hace |
|---|---|
| `01-predecir.json` | Baja el calendario real, predice las series que todavía NO empezaron y las guarda en Supabase |
| `02-calificar.json` | Cruza predicciones pendientes contra resultados reales de OpenDota y calcula el Brier |

## ⚠️ Antes de nada: n8n deshabilita Execute Command por defecto

Verificado en la instalación real (n8n 2.34.5, `@n8n/config/dist/configs/nodes.config.js`):

```js
this.exclude = ['n8n-nodes-base.executeCommand', 'n8n-nodes-base.localFileTrigger'];
```

El nodo **está en disco pero n8n no lo carga**. Si importas estos flujos sin
más, el nodo aparece como *"This node is not currently installed"* y el
flujo no puede correr. El import NO da error — falla en silencio hasta que
intentas ejecutarlo.

Está excluido a propósito: permite ejecutar comandos arbitrarios del sistema
operativo desde un workflow. En una instancia local de un solo usuario el
riesgo es acotado, pero **la decisión de habilitarlo es del dueño**, no algo
que se deba dar por hecho.

Para habilitarlo hay que arrancar n8n con la variable de entorno, dejando
`localFileTrigger` excluido (no lo necesitamos):

```bash
NODES_EXCLUDE='["n8n-nodes-base.localFileTrigger"]' npx n8n start
```

En PowerShell:

```bash
$env:NODES_EXCLUDE='["n8n-nodes-base.localFileTrigger"]'; npx n8n start
```

Después de arrancar así, confirmar que funcionó: en un workflow, presionar
`N` y buscar "Execute Command". Si aparece en la lista, quedó habilitado. Si
sigue diciendo "We didn't make that... yet", la variable no se aplicó.

### Alternativa sin bajar esa protección

Estos flujos no hacen nada que n8n aporte de verdad: son dos scripts de Node
en la misma máquina, sin ramificaciones ni integraciones. El Programador de
tareas de Windows los corre igual, sin habilitar ejecución de comandos
arbitrarios en un servicio web. Ver `n8n/../scripts/` — `predecir.cmd` y
`calificar.cmd` están listos para apuntarles una tarea programada.

## Cómo importar (gotchas reales, verificados)

1. **Create workflow** primero (canvas vacío). El menú de la lista de
   Overview no tiene opción de importar.
2. Menú ⋮ (arriba a la derecha) → **Import from file** → elegir el JSON.
3. n8n **no renombra el workflow** al nombre interno del JSON. Va a seguir
   diciendo "My workflow". Cambiar el título a mano para que coincida con el
   archivo.
4. **Guardar explícito con Ctrl+S antes de navegar a otro lado.** El import
   solo reemplaza el contenido del canvas abierto — si no se guarda, se
   pierde en silencio sin ningún mensaje de error.
5. Abrir el nodo **Trigger** y ponerle un intervalo real (queda en el
   default). Cada 1-2 horas es razonable: `dota.haglund.dev` cachea 3h del
   lado de ellos, pedirlo más seguido no trae nada nuevo.
6. Activar el flujo con el toggle.

## Lo que está verificado y lo que no

- **Verificado en la instalación real:** `scheduleTrigger` (v1.3) y
  `stickyNote` cargan bien; `executeCommand` existe en disco con
  `typeVersion: 1` correcto pero **excluido por default** (ver arriba).
- **No verificado:** ninguno de estos dos flujos se ha ejecutado de verdad
  en n8n todavía, justamente porque el nodo estaba deshabilitado. Los
  scripts que invocan (`juez/vivo-motor.mjs`, `juez/vivo-notas.mjs`) sí
  están verificados corriendo a mano contra Supabase real.
- **Sin flujo de error central** para estos dos. Si algo falla, queda en el
  log de ejecución de n8n y en ningún otro lado.
