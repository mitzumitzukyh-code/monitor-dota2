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

### Lo que se usa de verdad: Programador de tareas de Windows

**Decidido el 2026-08-14: la automatización NO corre por n8n.** Estos flujos
no hacen nada que n8n aporte — son dos scripts de Node en la misma máquina,
sin ramificaciones ni integraciones. El Programador de tareas los corre
igual, sin habilitar ejecución de comandos arbitrarios en un servicio web.
Los JSON quedan en el repo por si algún día hace falta n8n de verdad.

Tareas creadas y verificadas corriendo (resultado 0, con rastro en los logs):

| Tarea | Script | Frecuencia |
|---|---|---|
| `MonitorDota2-Predecir` | `scripts\predecir.cmd` | cada hora, :05 |
| `MonitorDota2-Calificar` | `scripts\calificar.cmd` | cada hora, :35 |
| `MonitorDota2-Panel` | `scripts\panel.cmd` | cada hora, :50 |
| `MonitorDota2-Avisar` | `scripts\avisar.cmd` | cada hora, :55 |

Están desfasadas a propósito: primero se predice, media hora después se
califica lo que ya terminó, después se regenera el panel web
(`salida/web/index.html`), y al final sale el aviso por Discord.

## Cómo te enterás de las predicciones

Tres formas, de menos a más automática:

1. **El panel web**: abrir `salida/web/index.html` (doble click, no necesita
   servidor). Se regenera solo cada hora.
2. **Discord**: `MonitorDota2-Avisar` manda un mensaje cuando hay
   predicciones nuevas y otro cuando se califican series. **Requiere poner
   `DISCORD_WEBHOOK` en `.env`** — sin eso la tarea corre, no revienta, y
   deja en `scripts/log-avisar.txt` que falta el webhook.

   Para sacar el webhook: en Discord, Configuración del canal → 
   Integraciones → Webhooks → Nuevo webhook → Copiar URL.

   No repite avisos: lleva registro en `salida/avisados.json` de lo que ya
   mandó, y **sólo marca como avisado lo que de verdad se envió**, así un
   Discord caído no hace perder el aviso para siempre.
3. **Los logs**: `scripts/log-*.txt`, uno por tarea, con el código de salida
   de cada corrida. Ahí se ve si algo falló, porque el Programador de tareas
   sólo guarda el número.

Para ver el estado, correr a mano o borrarlas cuando TI2026 termine (23 de
agosto):

```bash
schtasks /query /tn "MonitorDota2-Predecir" /fo LIST /v
```

```bash
schtasks /run /tn "MonitorDota2-Calificar"
```

```bash
schtasks /delete /tn "MonitorDota2-Predecir" /f
```

Los scripts dejan rastro en `scripts/log-predecir.txt` y
`scripts/log-calificar.txt` (en `.gitignore`, crecen con cada corrida).
Ahí se ve si una corrida falló, porque el Programador solo guarda el código
de salida.

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
