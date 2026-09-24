import type { AppLanguage } from "./appLanguage";

export const appStrings = {
  en: {
    appName: "Iliad MD",
    launch: {
      openingWorkspace: "Opening workspace",
      localMarkdownWriting: "Local Markdown writing",
      openFolder: "Open Folder"
    },
    topbar: {
      hideFileTree: "Hide file tree",
      showFileTree: "Show file tree",
      backTo: (name: string) => `Back to ${name}`,
      noPreviousDocument: "No previous document",
      forwardTo: (name: string) => `Forward to ${name}`,
      noNextDocument: "No next document",
      focusMode: "Focus mode",
      exitFocusMode: "Exit focus mode",
      saveStatus: {
        saved: (time: string) => `Saved ${time}`,
        saving: "Saving...",
        unsaved: "Unsaved",
        error: "Error",
        conflict: "Changed outside Iliad"
      }
    },
    documentClose: {
      close: "Close document",
      title: "Close document?",
      body: "This document has unsaved changes or a save error.",
      saveAndClose: "Save and close",
      closeWithoutSaving: "Close without saving",
      cancel: "Cancel",
      saving: "Finish saving before closing."
    },
    language: {
      title: "Language",
      ariaLabel: "App language",
      english: "English",
      spanish: "Español"
    },
      sidebar: {
      newDocument: "New document",
      newDocumentIn: (target: string) => `New document in ${target}`,
      newFolder: "New folder",
      newFolderIn: (target: string) => `New folder in ${target}`,
      changeFolder: "Change folder",
      openFolder: "Open folder…",
      recent: "Recent",
      noFiles: "No files",
      workspaceRoot: "Workspace root",
      fileTreeMoveStarted: (path: string) => `Moving ${path}`,
      fileTreeMoveTarget: (path: string) => `Move to ${path}`,
      fileTreeMoveRootTarget: "Move to workspace root",
      fileTreeMoveCanceled: "Move canceled",
      fileTreeMoveCompleted: (path: string) => `Moved ${path}`,
      fileTreeMoveFailed: "Move failed",
      pendingEdit: (path: string) => `Pending edit: ${path}`,
      proposedNewDocument: (path: string) => `Proposed new document: ${path}`,
      pendingDelete: (path: string) => `Pending delete: ${path}`,
      pendingReviewSummary: (count: number) => (count === 1 ? "1 pending review item" : `${count} pending review items`),
      acceptPendingChanges: "Accept all",
      rejectPendingChanges: "Reject all",
      rename: (name: string) => `Rename ${name}`,
      resizeFileTree: "Resize file tree",
      fileTreeWidthValue: (width: number) => `File tree width ${width} pixels`,
      findInFileTree: "Find in file tree",
      fileTreeSearchPlaceholder: "Find files",
      clearFileTreeSearch: "Clear file tree search",
      closeFileTreeSearch: "Close file tree search",
      fileTreeSearchDone: "Done",
      previousFileTreeMatch: "Previous file tree match",
      nextFileTreeMatch: "Next file tree match",
      toggleFileTreeFilter: "Filter file tree results",
      fileTreeFilterLabel: "Filter",
      fileTreeFilterOn: "Filtering results",
      fileTreeFilterOff: "Highlighting matches in place",
      toggleFileTreeFuzzy: "Loose file tree search",
      fileTreeFuzzyLabel: "Loose",
      fileTreeFuzzyOn: "Loose search on: matches letters in order",
      fileTreeFuzzyOff: "Loose search off: matches exact text",
      fileTreeSearchNoResults: "No matching files",
      fileTreeSearchCount: (current: number, total: number) => `${current}/${total}`,
      fileTreeSearchMatchAria: (name: string, current: number, total: number) =>
        `${name}, match ${current} of ${total}`,
      fileTreeDescendantMatches: (count: number) => (count === 1 ? "1 descendant match" : `${count} descendant matches`),
      searchScope: "Search scope",
      searchNames: "Names",
      searchText: "Contents",
      fileTreeContentSearchPlaceholder: "Search document text",
      matchCase: "Match case",
      matchWholeWord: "Match whole word",
      useRegularExpression: "Use regular expression",
      contentSearchSearching: "Searching...",
      contentSearchNoMatches: "No document matches",
      contentSearchCount: (matches: number, files: number) => {
        const matchText = matches === 1 ? "1 match" : `${matches} matches`;
        const fileText = files === 1 ? "1 file" : `${files} files`;
        return `${matchText} in ${fileText}`;
      },
      contentSearchInvalidRegex: "Invalid regex",
      contentSearchFailed: "Search failed",
      contentSearchUsesSavedText: "Search uses last saved text",
      contentSearchTruncated: (shown: number) => `Showing first ${shown} matches`,
      contentSearchMoreInFile: (count: number) => (count === 1 ? "1 more" : `${count} more`),
      contentSearchMatchAria: (path: string, line: number, current: number, total: number) =>
        `${path}, line ${line}, match ${current} of ${total}`,
      contentSearchSkippedOversized: (count: number) =>
        count === 1 ? "1 oversized Markdown file skipped" : `${count} oversized Markdown files skipped`
    },
    treeContextMenu: {
      duplicate: "Duplicate",
      rename: "Rename",
      moveToWorkspaceRoot: "Move to workspace root",
      copyPath: "Copy path",
      revealInFinder: "Reveal in Finder",
      moveToTrash: "Move to Trash"
    },
    typography: {
      title: "Typography",
      dialogLabel: "Editor typography",
      decreaseFontSize: "Decrease editor font size",
      increaseFontSize: "Increase editor font size",
      fontPreset: "Editor font preset",
      presets: {
        serif: "Serif",
        sans: "Sans",
        mono: "Mono"
      },
      reset: "Reset"
    },
    writingAssists: {
      title: "Writing assists",
      dialogLabel: "Writing assists",
      corrector: "Corrector",
      autocomplete: "Autocomplete",
      correctorUnavailable: "English only for now",
      geminiKey: "Gemini API key",
      geminiKeyHint: "Powers autocomplete and the ✦ AI menu.",
      geminiKeyPlaceholder: "Paste your Gemini API key",
      geminiKeySave: "Save",
      geminiKeyCancel: "Cancel",
      geminiKeyRemove: "Remove",
      geminiKeyGet: "Get a key",
      geminiKeySaved: (last4: string) => `Gemini key ••••${last4}`,
      geminiKeyChange: "Change",
      geminiKeySaveFailed: "Could not save the key. Try again.",
      autocompleteNeedsKey: "Add a Gemini API key",
      suggestWhileTyping: "Suggest while I type", suggestWhileTypingOff: (key: string) => `Off: only when you press ${key}`,
      snooze: "Pause for 10 min", resume: "Resume suggestions",
      writingNotes: "Writing notes", useNotes: "Use for this document", voice: "Voice & audience", facts: "Facts, characters, things to remember…",
      shortcuts: "Shortcuts & accessibility", continueKey: "AI key", sentenceKey: "Sentence", paragraphKey: "Paragraph", ideaKey: "Full idea",
      continueKeyHint: "Sentence, Paragraph and Full idea ask for that length at once. The AI key suggests a sentence (press again for longer); with text selected it opens the AI menu.",
      accept: "Accept", alternatives: "Another", dismiss: "Dismiss", reset: "Reset shortcuts", announce: "Announce suggestions"
    },
    updates: {
      checkForUpdates: "Check for Updates...",
      checking: "Checking for updates...",
      available: (version: string) => `Iliad MD ${version} is available.`,
      current: (version: string) => `Iliad MD ${version} is up to date.`,
      checkFailed: "Could not check for updates.",
      download: "Download",
      viewRelease: "View Release",
      dismiss: "Dismiss"
    },
    editor: {
      emptyTitle: "Pick a file to start",
      emptyNewDocument: "New document",
      crashTitle: "Unable to render this document",
      visualMarkdown: {
        markdownImage: "Markdown image",
        youtubeVideo: "YouTube video",
        markTaskIncomplete: "Mark task incomplete",
        markTaskComplete: "Mark task complete"
      },
      selectionComments: {
        action: "Comment",
        composerLabel: "Comment on selection",
        composerPlaceholder: "Add a comment…",
        edit: "Edit",
        delete: "Delete"
      },
      tighten: {
        action: "Shorten",
        working: "Shortening…",
        alreadyTight: "Already concise",
        failed: "Couldn't shorten — try again",
        noKey: "Add a Gemini API key in Writing assists to shorten",
        invalidKey: "The Gemini API key was rejected. Check it in Writing assists.",
        incomplete: "The AI couldn't finish — try a shorter selection",
        blocked: "The AI didn't return a rewrite for this text",
        addKey: "Add a Gemini API key in Writing assists to use AI",
        tooLong: "Selection too long to shorten",
        editAction: "Edit",
        editComposerLabel: "Edit selected text",
        editComposerPlaceholder: "Describe the change…",
        editWorking: "Editing…",
        editUnchanged: "No changes",
        editFailed: "Couldn't edit — try again",
        editNoKey: "Add a Gemini API key in Writing assists to edit",
        editTooLong: "Selection or instruction too long to edit",
        aiAction: "AI",
        aiMenuLabel: "AI actions for the selection",
        aiMenuPlaceholder: "Tell the AI what to do…",
        presets: { rewrite: "Rewrite", expand: "Expand", shorten: "Shorten", summarize: "Summarize", list: "Turn into a list" },
        presetInstructions: {
          rewrite: "Rewrite this so it reads more clearly and naturally, keeping the same meaning.",
          expand: "Expand this with more detail and development, keeping the same point and voice.",
          summarize: "Summarize this in fewer words, keeping only the key points.",
          list: "Turn this into a Markdown bulleted list, one idea per item."
        }
      },
      writingCorrector: {
        apply: "Apply",
        ignore: "Ignore",
        addToDictionary: "Add to dictionary",
        suggestion: "Suggestion",
        source: (source: string, ruleId: string) => `${source}: ${ruleId}`,
        stale: "This suggestion is stale.",
        openActions: "Open correction actions"
      },
      ideaAutocomplete: {
        accept: "Accept", another: "Another", longer: "Longer", steer: "Steer…", steerLabel: "Direction for this suggestion", steerPlaceholder: "e.g. give an example", previous: "Previous suggestion", next: "Next suggestion", dismiss: "Dismiss", suggestion: "Suggestion",
        working: "Suggesting…",
        noProvider: "Add a Gemini API key in Writing assists.",
        invalidApiKey: "The Gemini API key was rejected. Check it in Writing assists.",
        rateLimited: "Autocomplete is rate-limited. Try again shortly.",
        tooLong: "Autocomplete context is too long here.",
        timeout: "Autocomplete took too long. Try again.",
        unavailable: "Autocomplete is unavailable right now.",
        noSuggestion: "No suggestion yet.",
        unavailableInDocument: "Autocomplete needs more writable text here."
      },
      conflictBanner: {
        title: "This file changed outside Iliad while you were editing.",
        orphanTitle: "This file on disk no longer matches what Iliad last read.",
        restore: "Restore previous version",
        keep: "Keep outside changes",
        reload: "Reload from disk",
        confirmDiscard: "Your unsaved edits in this file will be discarded. Keep the outside changes?"
      },
      reviewToolbar: {
        changes: (count: number) => (count === 1 ? "1 change" : `${count} changes`),
        previous: "Previous change",
        next: "Next change",
        acceptAll: "Accept changes",
        rejectAll: "Reject changes",
        rejectRemaining: "Reject changes",
        create: "Create",
        delete: "Delete",
        discard: "Discard",
        keepChanges: "Keep changes",
        restorePreviousVersion: "Restore previous version",
        keepFile: "Keep file",
        moveToTrash: "Move to Trash",
        confirmDeletion: "Confirm deletion",
        restoreFile: "Restore file",
        keepEmptyFile: "Keep empty file",
        restoreText: "Restore text",
        stale: "Stale",
        acceptChange: "Accept changes",
        rejectChange: "Reject changes",
        pendingDocument: (path: string) => `Pending document: ${path}`,
        pendingDeleteDocument: (path: string) => `Pending delete: ${path}`
      }
    },
    review: {
      applied: "Kept outside changes",
      created: "Kept new document",
      discarded: "Restored previous versions",
      outsideChangeStale: "That file changed again outside Iliad. The review was refreshed; look at the new version before deciding.",
      errorFallback: "The review action failed. Try again.",
      fileChanged: "The document for this change is no longer available."
    },
    toast: {
      dismiss: "Dismiss"
    },
    workspaceMessages: {
      launchWorkspaceFallback: "Unable to read launch workspace.",
      missingWorkspace: "The last workspace is no longer available. Choose a folder to continue.",
      readWorkspaceFallback: "Unable to read workspace.",
      recentMissing: "That folder is no longer available.",
      watcherDegraded: "Iliad stopped receiving file changes for this folder. Reopen the workspace to watch it again."
    },
    documentMessages: {
      saveDocumentFallback: "Unable to save document."
    },
    fileMessages: {
      readImageFallback: "Unable to read image.",
      openedExternally: (name: string) => `Opened ${name} externally.`,
      openFileFallback: "Unable to open file.",
      createFileFallback: "Unable to create file.",
      createFolderFallback: "Unable to create folder.",
      renameItemFallback: "Unable to rename item.",
      duplicateItemFallback: "Unable to duplicate item.",
      moveItemFallback: "Unable to move item.",
      moveToTrashFallback: "Unable to move item to Trash.",
      copyPathFallback: "Unable to copy path.",
      copiedPath: "Copied path.",
      revealInFinderFallback: "Unable to reveal item.",
      openLinkFallback: "Unable to open link.",
      createdFileMissing: "Created file was not found after refreshing the workspace.",
      createdFolderMissing: "Created folder was not found after refreshing the workspace.",
      renamedFileMissing: "Renamed file was not found after refreshing the workspace.",
      duplicatedFileMissing: "Duplicated file was not found after refreshing the workspace.",
      movedFileMissing: "Moved item was not found after refreshing the workspace.",
      movedItem: (relativePath: string) => `Moved ${relativePath}.`,
      openMarkdownBeforeImages: "Open a Markdown document before adding images.",
      savedImage: (relativePath: string) => `Copied image to ${relativePath}`,
      linkedImage: (relativePath: string) => `Inserted image link to ${relativePath}`,
      unsupportedImage: "This image format is not supported.",
      headingLinksUnsupported: "Heading links are not supported yet.",
      trashConfirmation: (name: string, kind: "directory" | "file") =>
        kind === "directory" ? `Move "${name}" and its contents to Trash?` : `Move "${name}" to Trash?`
    },
    nativeDialog: {
      openFolderTitle: "Open Folder"
    }
  },
  es: {
    appName: "Iliad MD",
    launch: {
      openingWorkspace: "Abriendo espacio de trabajo",
      localMarkdownWriting: "Escritura Markdown local",
      openFolder: "Abrir carpeta"
    },
    topbar: {
      hideFileTree: "Ocultar árbol de archivos",
      showFileTree: "Mostrar árbol de archivos",
      backTo: (name: string) => `Volver a ${name}`,
      noPreviousDocument: "No hay documento anterior",
      forwardTo: (name: string) => `Avanzar a ${name}`,
      noNextDocument: "No hay documento siguiente",
      focusMode: "Modo de enfoque",
      exitFocusMode: "Salir del modo de enfoque",
      saveStatus: {
        saved: (time: string) => `Guardado ${time}`,
        saving: "Guardando...",
        unsaved: "Sin guardar",
        error: "Error",
        conflict: "Cambiado fuera de Iliad"
      }
    },
    documentClose: {
      close: "Cerrar documento",
      title: "¿Cerrar documento?",
      body: "Este documento tiene cambios sin guardar o un error de guardado.",
      saveAndClose: "Guardar y cerrar",
      closeWithoutSaving: "Cerrar sin guardar",
      cancel: "Cancelar",
      saving: "Espera a que termine de guardar antes de cerrar."
    },
    language: {
      title: "Idioma",
      ariaLabel: "Idioma de la app",
      english: "English",
      spanish: "Español"
    },
    sidebar: {
      newDocument: "Nuevo documento",
      newDocumentIn: (target: string) => `Nuevo documento en ${target}`,
      newFolder: "Nueva carpeta",
      newFolderIn: (target: string) => `Nueva carpeta en ${target}`,
      changeFolder: "Cambiar carpeta",
      openFolder: "Abrir carpeta…",
      recent: "Recientes",
      noFiles: "Sin archivos",
      workspaceRoot: "Raíz del espacio",
      fileTreeMoveStarted: (path: string) => `Moviendo ${path}`,
      fileTreeMoveTarget: (path: string) => `Mover a ${path}`,
      fileTreeMoveRootTarget: "Mover a la raíz del espacio",
      fileTreeMoveCanceled: "Movimiento cancelado",
      fileTreeMoveCompleted: (path: string) => `Se movió ${path}`,
      fileTreeMoveFailed: "No se pudo mover",
      pendingEdit: (path: string) => `Edición pendiente: ${path}`,
      proposedNewDocument: (path: string) => `Documento nuevo propuesto: ${path}`,
      pendingDelete: (path: string) => `Eliminación pendiente: ${path}`,
      pendingReviewSummary: (count: number) =>
        count === 1 ? "1 cambio pendiente de revisión" : `${count} cambios pendientes de revisión`,
      acceptPendingChanges: "Aceptar todo",
      rejectPendingChanges: "Rechazar todo",
      rename: (name: string) => `Renombrar ${name}`,
      resizeFileTree: "Redimensionar árbol de archivos",
      fileTreeWidthValue: (width: number) => `Ancho del árbol de archivos: ${width} píxeles`,
      findInFileTree: "Buscar en archivos",
      fileTreeSearchPlaceholder: "Buscar archivos",
      clearFileTreeSearch: "Limpiar búsqueda de archivos",
      closeFileTreeSearch: "Cerrar búsqueda de archivos",
      fileTreeSearchDone: "Listo",
      previousFileTreeMatch: "Resultado anterior en archivos",
      nextFileTreeMatch: "Resultado siguiente en archivos",
      toggleFileTreeFilter: "Filtrar resultados de archivos",
      fileTreeFilterLabel: "Filtro",
      fileTreeFilterOn: "Filtrando resultados",
      fileTreeFilterOff: "Resaltando coincidencias en el árbol",
      toggleFileTreeFuzzy: "Búsqueda flexible de archivos",
      fileTreeFuzzyLabel: "Flexible",
      fileTreeFuzzyOn: "Búsqueda flexible activada: coincide con letras en orden",
      fileTreeFuzzyOff: "Búsqueda flexible desactivada: coincide con texto exacto",
      fileTreeSearchNoResults: "Sin archivos coincidentes",
      fileTreeSearchCount: (current: number, total: number) => `${current}/${total}`,
      fileTreeSearchMatchAria: (name: string, current: number, total: number) =>
        `${name}, resultado ${current} de ${total}`,
      fileTreeDescendantMatches: (count: number) =>
        count === 1 ? "1 coincidencia descendiente" : `${count} coincidencias descendientes`,
      searchScope: "Alcance de búsqueda",
      searchNames: "Nombres",
      searchText: "Contenido",
      fileTreeContentSearchPlaceholder: "Buscar texto en documentos",
      matchCase: "Distinguir mayúsculas",
      matchWholeWord: "Palabra completa",
      useRegularExpression: "Usar expresión regular",
      contentSearchSearching: "Buscando...",
      contentSearchNoMatches: "Sin coincidencias en documentos",
      contentSearchCount: (matches: number, files: number) => {
        const matchText = matches === 1 ? "1 coincidencia" : `${matches} coincidencias`;
        const fileText = files === 1 ? "1 archivo" : `${files} archivos`;
        return `${matchText} en ${fileText}`;
      },
      contentSearchInvalidRegex: "Regex no válida",
      contentSearchFailed: "No se pudo buscar",
      contentSearchUsesSavedText: "La búsqueda usa el último texto guardado",
      contentSearchTruncated: (shown: number) => `Mostrando las primeras ${shown} coincidencias`,
      contentSearchMoreInFile: (count: number) => (count === 1 ? "1 más" : `${count} más`),
      contentSearchMatchAria: (path: string, line: number, current: number, total: number) =>
        `${path}, línea ${line}, coincidencia ${current} de ${total}`,
      contentSearchSkippedOversized: (count: number) =>
        count === 1 ? "1 archivo Markdown demasiado grande omitido" : `${count} archivos Markdown demasiado grandes omitidos`
    },
    treeContextMenu: {
      duplicate: "Duplicar",
      rename: "Renombrar",
      moveToWorkspaceRoot: "Mover a la raíz del espacio",
      copyPath: "Copiar ruta",
      revealInFinder: "Mostrar en Finder",
      moveToTrash: "Mover a la papelera"
    },
    typography: {
      title: "Tipografía",
      dialogLabel: "Tipografía del editor",
      decreaseFontSize: "Reducir tamaño de letra del editor",
      increaseFontSize: "Aumentar tamaño de letra del editor",
      fontPreset: "Estilo de letra del editor",
      presets: {
        serif: "Serif",
        sans: "Sans",
        mono: "Mono"
      },
      reset: "Restablecer"
    },
    writingAssists: {
      title: "Ayudas de escritura",
      dialogLabel: "Ayudas de escritura",
      corrector: "Corrector",
      autocomplete: "Autocompletar",
      correctorUnavailable: "Solo inglés por ahora",
      geminiKey: "Clave API de Gemini",
      geminiKeyHint: "Activa el autocompletado y el menú ✦ IA.",
      geminiKeyPlaceholder: "Pega tu clave API de Gemini",
      geminiKeySave: "Guardar",
      geminiKeyCancel: "Cancelar",
      geminiKeyRemove: "Quitar",
      geminiKeyGet: "Obtener una clave",
      geminiKeySaved: (last4: string) => `Clave Gemini ••••${last4}`,
      geminiKeyChange: "Cambiar",
      geminiKeySaveFailed: "No se pudo guardar la clave. Intenta de nuevo.",
      autocompleteNeedsKey: "Agrega una clave API de Gemini",
      suggestWhileTyping: "Sugerir mientras escribo", suggestWhileTypingOff: (key: string) => `Desactivado: solo al presionar ${key}`,
      snooze: "Pausar 10 min", resume: "Reanudar sugerencias",
      writingNotes: "Notas de escritura", useNotes: "Usar para este documento", voice: "Voz y audiencia", facts: "Hechos, personajes, cosas que recordar…",
      shortcuts: "Atajos y accesibilidad", continueKey: "Tecla de IA", sentenceKey: "Oración", paragraphKey: "Párrafo", ideaKey: "Idea completa",
      continueKeyHint: "Oración, Párrafo e Idea completa piden ese largo de una vez. La tecla de IA sugiere una oración (presiona de nuevo para alargar); con texto seleccionado abre el menú de IA.",
      accept: "Aceptar", alternatives: "Otra", dismiss: "Descartar", reset: "Restablecer atajos", announce: "Anunciar sugerencias"
    },
    updates: {
      checkForUpdates: "Buscar actualizaciones...",
      checking: "Buscando actualizaciones...",
      available: (version: string) => `Iliad MD ${version} está disponible.`,
      current: (version: string) => `Iliad MD ${version} está actualizado.`,
      checkFailed: "No se pudo buscar actualizaciones.",
      download: "Descargar",
      viewRelease: "Ver versión",
      dismiss: "Cerrar"
    },
    editor: {
      emptyTitle: "Elige un archivo para empezar",
      emptyNewDocument: "Nuevo documento",
      crashTitle: "No se pudo mostrar este documento",
      visualMarkdown: {
        markdownImage: "Imagen Markdown",
        youtubeVideo: "Video de YouTube",
        markTaskIncomplete: "Marcar tarea como incompleta",
        markTaskComplete: "Marcar tarea como completa"
      },
      selectionComments: {
        action: "Comentar",
        composerLabel: "Comentar la selección",
        composerPlaceholder: "Añade un comentario…",
        edit: "Editar",
        delete: "Eliminar"
      },
      tighten: {
        action: "Acortar",
        working: "Acortando…",
        alreadyTight: "Ya está conciso",
        failed: "No se pudo acortar; inténtalo de nuevo",
        noKey: "Agrega una clave API de Gemini en Ayudas de escritura para acortar",
        invalidKey: "La clave API de Gemini fue rechazada. Revísala en Ayudas de escritura.",
        incomplete: "La IA no pudo terminar; prueba con una selección más corta",
        blocked: "La IA no devolvió una reescritura para este texto",
        addKey: "Agrega una clave API de Gemini en Ayudas de escritura para usar IA",
        tooLong: "Selección demasiado larga para acortar",
        editAction: "Editar",
        editComposerLabel: "Editar la selección",
        editComposerPlaceholder: "Describe el cambio…",
        editWorking: "Editando…",
        editUnchanged: "Sin cambios",
        editFailed: "No se pudo editar; inténtalo de nuevo",
        editNoKey: "Agrega una clave API de Gemini en Ayudas de escritura para editar",
        editTooLong: "Selección o instrucción demasiado larga para editar",
        aiAction: "IA",
        aiMenuLabel: "Acciones de IA para la selección",
        aiMenuPlaceholder: "Dile a la IA qué hacer…",
        presets: { rewrite: "Reescribir", expand: "Ampliar", shorten: "Acortar", summarize: "Resumir", list: "Convertir en lista" },
        presetInstructions: {
          rewrite: "Reescribe esto para que se lea de forma más clara y natural, con el mismo significado.",
          expand: "Amplía esto con más detalle y desarrollo, manteniendo la misma idea y voz.",
          summarize: "Resume esto en menos palabras, conservando solo los puntos clave.",
          list: "Convierte esto en una lista Markdown con viñetas, una idea por elemento."
        }
      },
      writingCorrector: {
        apply: "Aplicar",
        ignore: "Ignorar",
        addToDictionary: "Agregar al diccionario",
        suggestion: "Sugerencia",
        source: (source: string, ruleId: string) => `${source}: ${ruleId}`,
        stale: "Esta sugerencia quedó obsoleta.",
        openActions: "Abrir acciones de corrección"
      },
      ideaAutocomplete: {
        accept: "Aceptar", another: "Otra", longer: "Más largo", steer: "Guiar…", steerLabel: "Dirección para esta sugerencia", steerPlaceholder: "p. ej. da un ejemplo", previous: "Sugerencia anterior", next: "Siguiente sugerencia", dismiss: "Descartar", suggestion: "Sugerencia",
        working: "Sugiriendo…",
        noProvider: "Agrega una clave API de Gemini en Ayudas de escritura.",
        invalidApiKey: "La clave API de Gemini fue rechazada. Revísala en Ayudas de escritura.",
        rateLimited: "Autocompletar está limitado. Intenta de nuevo en un momento.",
        tooLong: "El contexto de autocompletar es demasiado largo aquí.",
        timeout: "Autocompletar tardó demasiado. Intenta de nuevo.",
        unavailable: "Autocompletar no está disponible ahora.",
        noSuggestion: "Sin sugerencia por ahora.",
        unavailableInDocument: "Autocompletar necesita más texto editable aquí."
      },
      conflictBanner: {
        title: "Este archivo cambió fuera de Iliad mientras lo editabas.",
        orphanTitle: "El archivo en disco ya no coincide con lo último que leyó Iliad.",
        restore: "Restaurar versión anterior",
        keep: "Conservar cambios externos",
        reload: "Recargar desde disco",
        confirmDiscard: "Tus ediciones sin guardar en este archivo se descartarán. ¿Conservar los cambios externos?"
      },
      reviewToolbar: {
        changes: (count: number) => (count === 1 ? "1 cambio" : `${count} cambios`),
        previous: "Cambio anterior",
        next: "Cambio siguiente",
        acceptAll: "Aceptar cambios",
        rejectAll: "Rechazar cambios",
        rejectRemaining: "Rechazar cambios",
        create: "Crear",
        delete: "Eliminar",
        discard: "Descartar",
        keepChanges: "Conservar cambios",
        restorePreviousVersion: "Restaurar versión anterior",
        keepFile: "Conservar archivo",
        moveToTrash: "Mover a la papelera",
        confirmDeletion: "Confirmar eliminación",
        restoreFile: "Restaurar archivo",
        keepEmptyFile: "Conservar archivo vacío",
        restoreText: "Restaurar texto",
        stale: "Obsoleto",
        acceptChange: "Aceptar cambios",
        rejectChange: "Rechazar cambios",
        pendingDocument: (path: string) => `Documento pendiente: ${path}`,
        pendingDeleteDocument: (path: string) => `Eliminación pendiente: ${path}`
      }
    },
    review: {
      applied: "Cambios externos conservados",
      created: "Documento nuevo conservado",
      discarded: "Versiones anteriores restauradas",
      outsideChangeStale: "Ese archivo volvió a cambiar fuera de Iliad. La revisión se actualizó; mira la nueva versión antes de decidir.",
      errorFallback: "No se pudo completar la revisión. Intenta de nuevo.",
      fileChanged: "El documento de este cambio ya no está disponible."
    },
    toast: {
      dismiss: "Cerrar"
    },
    workspaceMessages: {
      launchWorkspaceFallback: "No se pudo leer el espacio de trabajo de inicio.",
      missingWorkspace: "El último espacio de trabajo ya no está disponible. Elige una carpeta para continuar.",
      readWorkspaceFallback: "No se pudo leer el espacio de trabajo.",
      recentMissing: "Esa carpeta ya no está disponible.",
      watcherDegraded: "Iliad dejó de recibir cambios de archivos en esta carpeta. Vuelve a abrir el espacio de trabajo para observarla de nuevo."
    },
    documentMessages: {
      saveDocumentFallback: "No se pudo guardar el documento."
    },
    fileMessages: {
      readImageFallback: "No se pudo leer la imagen.",
      openedExternally: (name: string) => `Se abrió ${name} externamente.`,
      openFileFallback: "No se pudo abrir el archivo.",
      createFileFallback: "No se pudo crear el archivo.",
      createFolderFallback: "No se pudo crear la carpeta.",
      renameItemFallback: "No se pudo renombrar el elemento.",
      duplicateItemFallback: "No se pudo duplicar el elemento.",
      moveItemFallback: "No se pudo mover el elemento.",
      moveToTrashFallback: "No se pudo mover el elemento a la papelera.",
      copyPathFallback: "No se pudo copiar la ruta.",
      copiedPath: "Ruta copiada.",
      revealInFinderFallback: "No se pudo mostrar el elemento.",
      openLinkFallback: "No se pudo abrir el enlace.",
      createdFileMissing: "El archivo creado no apareció al actualizar el espacio de trabajo.",
      createdFolderMissing: "La carpeta creada no apareció al actualizar el espacio de trabajo.",
      renamedFileMissing: "El archivo renombrado no apareció al actualizar el espacio de trabajo.",
      duplicatedFileMissing: "El archivo duplicado no apareció al actualizar el espacio de trabajo.",
      movedFileMissing: "El elemento movido no apareció al actualizar el espacio de trabajo.",
      movedItem: (relativePath: string) => `Se movió ${relativePath}.`,
      openMarkdownBeforeImages: "Abre un documento Markdown antes de agregar imágenes.",
      savedImage: (relativePath: string) => `Imagen copiada en ${relativePath}`,
      linkedImage: (relativePath: string) => `Enlace de imagen insertado a ${relativePath}`,
      unsupportedImage: "Este formato de imagen no es compatible.",
      headingLinksUnsupported: "Los enlaces a encabezados aún no están disponibles.",
      trashConfirmation: (name: string, kind: "directory" | "file") =>
        kind === "directory"
          ? `Mover "${name}" y su contenido a la papelera?`
          : `Mover "${name}" a la papelera?`
    },
    nativeDialog: {
      openFolderTitle: "Abrir carpeta"
    }
  }
} as const;

export type AppStrings = (typeof appStrings)[AppLanguage];
