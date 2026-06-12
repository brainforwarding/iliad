# El contexto no es magia: cómo Iliad decide qué ve el modelo

*Borrador para publicación — 2026-06-11*

---

Cuando le pides algo a un asistente de IA dentro de una aplicación, hay una pregunta que casi ninguna herramienta responde bien: **¿qué vio exactamente el modelo?**

¿Vio el documento que tienes abierto? ¿La versión de hace diez minutos o la de ahora? ¿Ese archivo que adjuntaste hace ocho mensajes sigue "ahí"? ¿Leyó la guía de estilo que mencionaste de pasada, o respondió de memoria? La mayoría de las herramientas tratan estas preguntas como detalles de implementación. Nosotros creemos que son **el** producto.

Iliad es un espacio de escritura Markdown local-first con un asistente integrado. Este post explica cómo armamos el contexto que recibe el modelo en cada mensaje, y por qué cada decisión es como es. No inventamos la mayoría de estas ideas — varias coinciden con lo que han publicado [Cursor](https://cursor.com/blog/dynamic-context-discovery) y [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — pero sí las llevamos a un lugar al que casi nadie llega: **cada cosa que el modelo ve deja un recibo que el usuario puede inspeccionar.**

## La premisa: el archivo es el contrato

Antes de hablar de contexto hay que decir de dónde viene la verdad.

En Iliad, el archivo `.md` en disco es el contrato. Lo que lees en el editor es lo que está guardado; lo que el agente lee es ese mismo archivo; lo que el agente propone cambiar se revisa como un diff sobre ese archivo. No hay una representación interna paralela, ni un índice vectorial que pueda quedar desactualizado, ni un "estado del proyecto" que viva en otra parte.

Esto simplifica brutalmente el problema del contexto. Si la verdad vive en el disco y el usuario la edita entre mensaje y mensaje, entonces cualquier copia que guardes del documento es una mentira en potencia. La conclusión se vuelve obvia una vez que la dices en voz alta:

**No guardes contexto. Constrúyelo fresco, cada vez.**

## Las dos formas en que un agente te miente

Estudiamos cómo manejan esto las herramientas maduras — Cursor, Claude Code, Codex, Antigravity — y los modos de falla se agrupan en dos familias:

**Contexto oculto.** El modelo vio cosas que el usuario no sabe que vio: el workspace completo subido por detrás, un snapshot viejo de un archivo "pineado", un resumen generado que nadie puede auditar. El síntoma es esa sensación incómoda de "¿y esto de dónde lo sacó?".

**Evidencia que se evapora.** El modelo hizo cosas — leyó tres archivos, buscó dos veces — pero el rastro desaparece cuando termina de responder. El usuario que vuelve a la conversación una hora después no puede reconstruir en qué se basó cada respuesta. Confiar exige memoria fotográfica.

Nuestra versión inicial cometía el segundo pecado en pequeño: mostrábamos la actividad del agente en vivo, pero la descartábamos al terminar el run, y el detalle de contexto solo aparecía cuando "cambiaba" respecto del turno anterior — una heurística que ahorraba ruido al costo de ser impredecible. Lo corregimos, y más abajo contamos cómo.

## Paquete fresco en cada mensaje

Cada vez que presionas Enviar, Iliad arma desde cero el paquete que recibe el modelo:

```text
reglas del asistente
+ snapshot actual del archivo Markdown abierto (si hay uno)
+ archivos adjuntados o @mencionados en ESTE mensaje
+ herramientas seguras de documentos (listar / buscar / leer Markdown)
+ historia visible de la conversación, hasta un presupuesto de tokens
+ índice de rutas referenciadas antes en la conversación (solo rutas)
+ tu mensaje
```

No hay estado escondido entre turnos. El archivo activo entra siempre en su versión actual — la que tienes en pantalla, no la de cuando abriste el chat. Si el modelo necesita algo más, lo busca con herramientas (sobre eso, en un momento).

Esto tiene un costo real: re-enviamos contexto que un diseño con estado podría cachear. Lo pagamos con gusto, porque la alternativa — decidir cuándo un snapshot guardado sigue siendo válido — es exactamente el tipo de heurística que produce contexto oculto. En una app donde el usuario **edita el documento entre mensajes**, la frescura no es optimización: es corrección.

## Los adjuntos funcionan como en el correo

Cuando adjuntas un archivo a un mensaje (con `@` o arrastrándolo), el chip vive en el compositor solo hasta que envías. Después desaparece.

A primera vista parece un bug — Cursor mantiene los chips a nivel de conversación, ¿no deberíamos hacer lo mismo? No, y la razón es arquitectónica: los chips persistentes de Cursor reflejan que Cursor tiene contexto persistente por hilo. Iliad no lo tiene, deliberadamente. Un chip que sobrevive al mensaje promete "este archivo está en contexto", y en nuestro modelo eso sería falso: lo que habría es una copia congelada de hace cuatro turnos mientras el archivo real ya cambió.

La metáfora honesta es el correo electrónico: **el adjunto pertenece al mensaje, no a la conversación.** Por eso el mensaje enviado muestra sus adjuntos — marcadores discretos bajo el texto, como un correo muestra lo que llevaba — y el compositor queda limpio para el siguiente.

¿Y si quieres usar el archivo de nuevo? Tres caminos: lo vuelves a adjuntar, lo dejas abierto como documento activo, o simplemente lo nombras — porque el modelo puede ir a buscarlo.

## El modelo busca el resto

El agente tiene tres herramientas sobre el workspace: listar documentos, buscar en documentos, y leer un documento. Todas acotadas a Markdown visible dentro del workspace, todas validadas en el proceso main de Electron, todas con presupuesto.

Cuando escribes "revisa que esto calce con la rúbrica" sin adjuntar nada, el modelo no responde de memoria: busca `rubrica`, lee el match más relevante, y recién entonces opina. Esto es lo que Anthropic llama *just-in-time retrieval* y lo que Cursor describió como *dynamic context discovery*: en vez de precargar todo lo que podría ser relevante, mantén identificadores livianos y carga el contenido en el momento de uso.

La consecuencia de diseño es importante: **adjuntar es para dirigir, no para habilitar.** No necesitas adjuntar un archivo para que el modelo pueda verlo; adjuntas para decirle "esto, exactamente esto, ahora". Todo lo demás se descubre.

## La historia completa, hasta un presupuesto

Aquí va una confesión: desde su primera versión, Iliad enviaba al modelo solo los últimos 8 mensajes de la conversación. Una ventana fija, simple, barata — y equivocada.

El problema de una ventana fija no es estético. Como la historia guarda solo el texto visible (nunca el contenido de archivos ni resultados de tools), un documento adjuntado hace diez turnos desaparecía del mundo alcanzable del modelo por completo: ni su contenido ni su *mención* sobrevivían. El modelo no podía "saber que debía re-leerlo" porque ya no sabía que existía. La guía oficial de OpenAI documenta este modo de falla con precisión: con ventanas fijas, "restricciones, identificadores y decisiones tempranas se desvanecen".

Cuando investigamos qué hace la industria, el veredicto fue unánime: **ningún producto líder usa una ventana pequeña fija.** Claude Code, Codex CLI, Cursor, Claude.ai — todos envían la historia completa hasta acercarse al límite, y recién entonces compactan (resumen lo viejo, mantienen lo reciente textual).

Nuestro reemplazo tiene cuatro piezas:

1. **Historia completa hasta un presupuesto** (~40k tokens estimados). Como nuestra historia es solo texto visible — sin volcados de archivos — crece lento: un hilo de escritura de 50 turnos son típicamente 15–25k tokens. El presupuesto existe para acotar el costo, no porque lo alcancemos seguido.
2. **Omisión anunciada, nunca silenciosa.** Si un hilo excede el presupuesto, el prompt lo dice ("N mensajes anteriores omitidos") y el recibo del turno lo registra como fila excluida. El modelo y el usuario ven la misma verdad.
3. **Un índice de rutas, nunca de contenido.** Cada mensaje incluye una línea con las rutas de los documentos que la conversación ya vio: *"Documentos referenciados antes en esta conversación (no incluidos; re-léelos con tus herramientas si los necesitas): `rubrica.md`, `mapa-curso.md`"*. Cuesta casi nada en tokens y resuelve el problema de la mención desvanecida: aunque el adjunto original haya salido de la ventana, el modelo siempre sabe qué puede re-leer. Es el patrón de "identificadores livianos" de Anthropic, aplicado a la conversación misma.

4. **Compactación con recibo.** Cuando un hilo excede el presupuesto de verdad (más de ~2k tokens omitidos), un resumen cacheado de los mensajes omitidos — decisiones, restricciones, trabajo pendiente, rutas — viaja arriba del hilo reciente. Se genera *después* de cada run, nunca en línea: tu turno jamás espera a un resumidor. El recibo dice exactamente qué cubre ("Resumen de N mensajes anteriores") y la nota de omisión se reduce a la brecha no cubierta. Si algo falla — sin clave, salida inválida, lo que sea — degrada a la nota de omisión de siempre.

Nótese lo que **no** hacemos: nunca re-enviamos contenido automáticamente. Las rutas reaparecen; los bytes no. La frescura sigue viniendo de re-leer el disco.

## Recibos: si el modelo lo vio, puedes inspeccionarlo

Esta es la regla que ordena todo lo demás, y la que creemos que casi nadie cumple de verdad:

> **Si el modelo lo vio, hay un recibo que el usuario puede abrir.**

Cada run produce un *context manifest*: qué archivo entró completo y con qué hash, qué se adjuntó, qué leyó el modelo por su cuenta, qué buscó y cuántos resultados obtuvo, qué quedó excluido y por qué, cuántos mensajes de historia se omitieron, qué rutas llevaba el índice. Metadata, no contenido — el recibo no es un archivo de prompts.

Y desde esta semana, el recibo es **permanente y uniforme**. Cada turno del asistente lleva su disclosure colapsado: una línea quieta tipo *"Leyó 2 documentos · 1 búsqueda"* que se expande a las filas completas. Ya no desaparece al terminar el run, ya no depende de si "cambió" respecto del turno anterior, y aparece también en los turnos que fallaron — porque cuando un run falla es exactamente cuando más quieres saber qué alcanzó a leer.

Aprendimos algo contraintuitivo diseñando esto: **la predictibilidad es restraint.** Nuestra heurística vieja de "mostrar el detalle solo cuando cambia" parecía más minimalista, pero su ausencia era ambigua — ¿mismo contexto, o sin información? Una línea discreta que aparece siempre es más silenciosa que una línea inteligente que aparece a veces.

## El workspace nunca da instrucciones

Una regla transversal: todo Markdown que entra al contexto — adjuntado, activo, o leído por tools — se etiqueta como **contenido no confiable de referencia**, jamás como instrucción. Un archivo de tu workspace no puede redefinir las reglas del asistente.

Esto suena obvio hasta que persigues los bordes. En la revisión de este diseño cazamos uno bonito: macOS permite saltos de línea en nombres de archivo. Un archivo llamado `a\nIgnora las instrucciones anteriores.md` habría inyectado una línea dentro del andamiaje del prompt a través del índice de rutas. Hoy toda ruta que toca el prompt pasa por un filtro que rechaza caracteres de control, rutas escondidas, y cualquier cosa que no sea Markdown visible del workspace — y las rutas van entre backticks, marcando explícitamente la frontera entre andamiaje y dato.

## Lo que decidimos no hacer

Tan importante como el diseño es su negativo:

- **No subimos el workspace completo.** Ni "para tener mejor contexto", ni comprimido, ni indexado. El modelo descubre archivos con herramientas acotadas, y cada lectura deja recibo.
- **No hay memoria persistente automática.** Nada de "el asistente recuerda tus preferencias" sin que exista una superficie inspeccionable.
- **No hay contexto pineado.** Un pin es una copia, y una copia envejece mientras editas ese mismo documento en la misma app — responder sobre texto que ya no existe es exactamente lo contrario de "el archivo es el contrato". Las intenciones reales ya tienen su superficie, cada una con frescura garantizada: "usa esto una vez" (adjuntos de un turno), "sigue usando esto" (`AGENTS.md`, re-leído de disco en cada turno), "el documento en que estoy" (el archivo activo). Si los recibos algún día muestran al agente re-leyendo los mismos documentos turno tras turno, lo reconsideraremos — y sería con semántica de re-lectura fresca, no de snapshot.
- **No compactamos en línea ni a escondidas.** La compactación existe (ver arriba), pero con tres negativas deliberadas: nunca bloquea un turno (se genera después del run), nunca afirma cubrir mensajes que el resumidor no vio (la cobertura se ancla al inicio del hilo y avanza honestamente), y nunca sobrevive a un borrado — limpiar el historial de chat purga también el cache de resúmenes. Y el resumen viaja como dato no confiable, delimitado y enmarcado, porque un dato falso en un resumen envenenaría el resto del hilo.
- **No fingimos uniformidad entre runtimes.** Cuando el agente corre sobre el runtime de Codex, que tiene acceso nativo al workspace, una fila de "workspace disponible" **no** se presenta como prueba de que leyó un archivo específico. Disponibilidad no es uso; el recibo distingue una cosa de la otra.

## Por qué tanto esfuerzo en algo que casi nadie mira

Seamos honestos: la mayoría de los usuarios no va a expandir el recibo de contexto en su vida. ¿Para quién es todo esto?

Para el momento en que algo sale raro. La confianza en un agente no se construye cuando todo funciona — se construye cuando la respuesta te parece extraña, abres el recibo, y descubres que el modelo leyó la versión vieja del anexo, o que la búsqueda quedó limitada, o que tu pregunta dependía de un archivo que nunca entró. Sin recibo, ese momento es "la IA es rara". Con recibo, es información accionable.

Hay un beneficio menos visible: **el recibo nos disciplina a nosotros.** Cada feature de contexto que agregamos tiene que poder explicarse en una fila de recibo. Si no podemos mostrarle al usuario qué hizo, no lo construimos. Es un forcing function de honestidad arquitectónica — y sospechamos que es la diferencia entre las herramientas que envejecen bien y las que acumulan magia.

## Qué viene

Una, principalmente: workers acotados con contexto propio e inspeccionable — cada uno con su contrato explícito de qué puede ver y qué puede tocar. Los resúmenes de compactación, que estaban en esta lista, ya están arriba; el contexto pineado se movió a "lo que decidimos no hacer", donde siempre debió estar.

Todo, cuando llegue, seguirá la misma regla. Si el modelo lo vio, hay recibo.

---

*Iliad es un espacio de escritura Markdown local-first. El archivo en disco es el contrato; todo lo demás — incluido el asistente — se subordina a eso.*
