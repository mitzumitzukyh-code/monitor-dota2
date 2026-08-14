' Lanza un .cmd SIN abrir ventana de consola.
'
' Las tareas programadas apuntaban directo a los .cmd, y como corren con
' token interactivo (para no tener que guardar la contraseña del usuario),
' Windows mostraba la ventana negra cada vez: cuatro por hora.
'
' WScript.Shell.Run con estilo 0 la esconde, y bWaitOnReturn=True hace que
' el codigo de salida del .cmd llegue al Programador de tareas, para que
' siga viendose si una corrida fallo.
'
' Uso:  wscript.exe //B "D:\monitor-dota2\scripts\oculto.vbs" "ruta\al.cmd"

Option Explicit

Dim shell, cmd, codigo

If WScript.Arguments.Count < 1 Then
  WScript.Quit 2
End If

cmd = WScript.Arguments(0)

Set shell = CreateObject("WScript.Shell")
codigo = shell.Run("""" & cmd & """", 0, True)

WScript.Quit codigo
