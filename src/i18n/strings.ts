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
        error: "Error"
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
      newFolder: "New folder",
      changeFolder: "Change folder",
      openFolder: "Open folder…",
      recent: "Recent",
      noFiles: "No files",
      pendingEdit: (path: string) => `Pending edit: ${path}`,
      proposedNewDocument: (path: string) => `Proposed new document: ${path}`,
      rename: (name: string) => `Rename ${name}`
    },
    treeContextMenu: {
      duplicate: "Duplicate",
      rename: "Rename",
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
        action: "Tighten",
        working: "Tightening…",
        alreadyTight: "Already tight",
        failed: "Couldn't tighten — try again",
        noKey: "Connect Codex or add an OpenAI API key in the assistant to tighten",
        tooLong: "Selection too long to tighten",
        editAction: "Edit",
        editComposerLabel: "Edit selected text",
        editComposerPlaceholder: "Describe the change…",
        editWorking: "Editing…",
        editUnchanged: "No changes",
        editFailed: "Couldn't edit — try again",
        editNoKey: "Connect Codex or add an OpenAI API key in the assistant to edit",
        editTooLong: "Selection or instruction too long to edit"
      },
      reviewToolbar: {
        changes: (count: number) => (count === 1 ? "1 change" : `${count} changes`),
        previous: "Previous change",
        next: "Next change",
        acceptAll: "Accept all",
        rejectAll: "Reject all",
        rejectRemaining: "Reject remaining",
        create: "Create",
        discard: "Discard",
        stale: "Stale",
        acceptChange: "Accept",
        rejectChange: "Reject",
        pendingDocument: (path: string) => `Pending document: ${path}`
      }
    },
    assistant: {
      title: "Agent",
      open: "Open agent",
      close: "Close agent",
      newChat: "New chat",
      history: {
        title: "History",
        back: "Back to chat",
        loading: "Loading history",
        empty: "No saved conversations",
        clear: "Clear history",
        clearConfirm: "Clear saved chat history for this workspace?",
        groups: {
          today: "Today",
          yesterday: "Yesterday",
          thisWeek: "This week",
          older: "Older"
        }
      },
      settings: "Agent settings",
      noActiveFile: "No file",
      missingKey: "Connect Codex or add an OpenAI API key before asking the agent.",
      connection: "Connection",
      apiKey: "OpenAI API key",
      apiKeyActive: "Active",
      apiKeySaved: "Saved",
      apiKeyPlaceholder: "sk-...",
      apiKeyHelper: "Saved locally. API usage is separate from ChatGPT plans.",
      getApiKey: "Get an API key",
      changeKey: "Change key",
      apiKeyRole: "Chat, editing, and dictation.",
      powersChat: "Powers chat",
      powersDictation: "Powers dictation",
      modelSection: "Model",
      model: "Agent model",
      modelHelper: "Codex-compatible models. gpt-5.5 is recommended.",
      mode: "Mode",
      saveSettings: "Save settings",
      send: "Send",
      stop: "Stop",
      dictation: {
        dictate: "Dictate",
        stopRecording: "Stop recording",
        transcribing: "Transcribing",
        recording: "Recording",
        couldNotTranscribe: "Could not transcribe",
        stopBeforeSending: "Stop recording before sending",
        unsupported: "Microphone dictation is not available",
        errors: {
          microphoneDenied: "Microphone access denied",
          noSpeechDetected: "No speech detected",
          recordingTooLong: "Recording too long",
          missingApiKey: "Add an OpenAI API key to dictate"
        }
      },
      codex: {
        title: "Codex",
        role: "ChatGPT plan.",
        checking: "Checking",
        notConnected: "Not connected",
        connecting: "Connecting",
        connected: "Connected",
        unavailable: "Unavailable",
        futureRuntime: "Chat uses Codex when connected.",
        currentChatUsesApiKey: "Dictation uses the OpenAI API key.",
        connectedCopy: "Chat uses Codex.",
        dictationUsesApiKey: "Dictation uses the OpenAI API.",
        disconnectedCopy: "Connect Codex or use an OpenAI API key for chat.",
        connect: "Connect Codex",
        openOpenAI: "Open OpenAI",
        cancel: "Cancel",
        disconnect: "Disconnect",
        refresh: "Refresh",
        deviceUrl: "Go to auth.openai.com/codex/device",
        copyCode: "Copy code",
        deviceAuthorizationHelp: "If OpenAI asks, enable device-code authorization in ChatGPT security settings.",
        signedInAs: (email: string) => `Signed in as ${email}`,
        plan: (plan: string) => `Plan: ${plan}`,
        rateLimit: (percent: number, windowDurationMins: number | null) =>
          windowDurationMins ? `${percent}% used in ${windowDurationMins} min window` : `${percent}% used`,
        unavailableCopy: "Codex unavailable.",
        cliNotFound: "Codex CLI not found.",
        errorFallback: "Could not update Codex connection. Try again."
      },
      remote: {
        section: "Remote access",
        title: "Telegram",
        checking: "Checking",
        disabled: "Disabled",
        enabled: "Enabled",
        paired: "Paired",
        unpaired: "Unpaired",
        role: "Ask from Telegram.",
        privacyCopy:
          "Telegram messages and Iliad replies pass through Telegram. Markdown files stay on this computer unless quoted or summarized in a reply.",
        readOnlyCopy: "Remote chat can answer questions with sources. It cannot edit files or approve changes.",
        enable: "Enable",
        disable: "Disable",
        pair: "Pair",
        revoke: "Revoke",
        pairingLink: "Pairing link",
        pairingCode: "Pairing code",
        copyLink: "Copy link",
        copyCode: "Copy code",
        openLink: "Open link",
        expiresAt: (date: string) => `Expires ${date}`,
        setupRequired: "Set up a Telegram relay URL before pairing.",
        secureUrlRequired: "Set a secure Telegram relay URL before connecting.",
        pairingUnavailable: "Telegram Remote Chat pairing is not available in this build.",
        pairedWith: (name: string) => `Paired with ${name}`,
        pairedAt: (date: string) => `Paired ${date}`,
        iliadChat: (title: string) => `Iliad chat: ${title}`,
        defaultRemoteChat: "Default remote chat",
        thisChat: "This chat",
        selectedChat: "Selected chat",
        useThisChat: "Use this chat",
        errorFallback: "Could not update Telegram Remote Chat settings. Try again."
      },
      promptPlaceholder: "Ask anything...",
      promptPlaceholderNoFile: "Ask anything...",
      promptRequired: "Enter a prompt first.",
      selectionComments: {
        chip: (count: number, name: string) => (count === 1 ? `1 comment · ${name}` : `${count} comments · ${name}`),
        openList: "Show pending comments",
        listLabel: "Pending comments",
        noAnchor: "no anchor",
        discard: "Discard comment",
        scrollTo: (excerpt: string) => `Go to "${excerpt}"`,
        disclosure: (count: number) => (count === 1 ? "1 comment" : `${count} comments`)
      },
      patchReady: "Reviewable replacement ready",
      documentReady: "New document ready",
      pendingChanges: "Pending changes",
      filesChanged: (count: number) => (count === 1 ? "1 file" : `${count} files`),
      review: "Review",
      reviewChanges: "Review changes",
      reviewDocument: "Review document",
      apply: "Apply",
      discard: "Discard",
      noTextResponse: "The agent returned no text.",
      errorFallback: "Agent request failed.",
      fileChanged: "Reopen the original document before applying this proposal.",
      context: {
        label: "Context for next message",
        auto: "Auto",
        autoTooltip: "Auto uses the current file and the workspace access available to this run.",
        currentFileTooltip: (path: string) => `Current file context: ${path}`,
        manualTooltip: (path: string) => `Attached file context: ${path}`,
        remove: (path: string) => `Remove ${path} from context`,
        attached: (path: string) => `Attached ${path} to context`,
        removed: (path: string) => `Removed ${path} from context`,
        alreadyAttached: (path: string) => `${path} is already attached`,
        maxManualAttachments: (limit: number) => `Manual context is limited to ${limit} files`,
        suggestionsLabel: "Markdown files to attach",
        attachSuggestion: (path: string) => `Attach ${path} to context`,
        noMatchingMarkdown: "No matching Markdown files",
        keepTypingToNarrow: "Keep typing to narrow results",
        dropRejected: "Drop a Markdown file from this workspace",
        noFileIncluded: "No file included",
        currentFile: "Current file",
        workspaceAccess: "Workspace access",
        workspaceFiles: "Workspace files",
        excludedWorkspace: "Other workspace files excluded",
        included: "Included",
        available: "Available",
        excluded: "Excluded",
        reference: "Reference",
        resultCount: (count: number) => (count === 1 ? "1 result" : `${count} results`),
        searchedPaths: (count: number) => (count === 1 ? "1 path searched" : `${count} paths searched`),
        searchedFiles: (count: number) => (count === 1 ? "1 file searched" : `${count} files searched`),
        truncated: "search capped",
        documentList: "Document list",
        documentSearch: "Document search",
        documentReadFailed: "Document read failed",
        historyOmitted: (count: number) =>
          count === 1 ? "1 earlier message not sent (history budget)" : `${count} earlier messages not sent (history budget)`,
        summaryUsed: (count: number) =>
          count === 1 ? "Summary of 1 earlier message" : `Summary of ${count} earlier messages`,
        selection: (lineStart: number, lineEnd: number) =>
          lineStart === lineEnd ? `Selection (line ${lineStart})` : `Selection (lines ${lineStart}-${lineEnd})`,
        selectionChip: (lineStart: number, lineEnd: number) =>
          lineStart === lineEnd ? `Selection · line ${lineStart}` : `Selection · lines ${lineStart}-${lineEnd}`,
        removeSelection: "Skip the selection for this message",
        workspaceRules: "Workspace rules",
        referencedEarlier: (count: number) =>
          count === 1
            ? "1 document referenced earlier in this conversation"
            : `${count} documents referenced earlier in this conversation`,
        provider: (provider: string, model: string) => `${provider} · ${model}`
      },
      activity: {
        label: "Agent activity",
        started: "Started",
        completed: "Done",
        failed: "Failed",
        documentList: "Listing documents",
        documentSearch: "Searching documents",
        documentSearchQuery: (query: string) => `Searching documents for "${query}"`,
        documentRead: (path: string) => `Reading ${path}`,
        documentReadGeneric: "Reading document",
        documentOpen: (path: string) => `Opening ${path}`,
        documentOpenGeneric: "Opening document",
        documentReadFailed: (path: string) => `Could not read ${path}`,
        documentReadFailedGeneric: "Could not read document"
      },
      receipt: {
        process: "Process",
        attachments: "Files attached to this message",
        reads: (count: number) => (count === 1 ? "Read 1 document" : `Read ${count} documents`),
        searches: (count: number) => (count === 1 ? "1 search" : `${count} searches`),
        opens: (count: number) => (count === 1 ? "Opened 1 document" : `Opened ${count} documents`),
        readsFailed: (count: number) => (count === 1 ? "1 read failed" : `${count} reads failed`),
        documentList: "Listed documents",
        documentSearch: "Searched documents",
        documentSearchQuery: (query: string) => `Searched documents for "${query}"`,
        documentRead: (path: string) => `Read ${path}`,
        documentReadGeneric: "Read document",
        documentOpen: (path: string) => `Opened ${path}`,
        documentOpenGeneric: "Opened document",
        documentReadFailed: (path: string) => `Could not read ${path}`,
        documentReadFailedGeneric: "Could not read document"
      },
      errors: {
        missing_api_key: "Connect Codex or add an OpenAI API key before asking the agent.",
        invalid_api_key: "The OpenAI API key was rejected. Check the saved key.",
        rate_limited: "OpenAI rate-limited this request. Try again shortly.",
        provider_unavailable: "The agent runtime is unavailable right now. Try again shortly.",
        network_unreachable: "Could not reach OpenAI. Check your connection and try again.",
        dns_failure: "Could not reach OpenAI. Check your internet or DNS connection and try again.",
        request_timeout: "The request took too long. Try again.",
        request_canceled: "Canceled.",
        model_not_found: "The selected model was not found. Check the model name in settings.",
        malformed_provider_response: "OpenAI returned an unexpected response. Try again.",
        unknown: "The agent request failed. Try again."
      },
      modes: {
        fast: "Fast",
        balanced: "Balanced",
        deep: "Deep"
      },
      proposalStatus: {
        pending: "Pending",
        partially_applied: "Partially applied",
        applied: "Applied",
        rejected: "Rejected",
        stale: "Stale",
        failed: "Failed"
      },
      status: {
        reading: "Reading context",
        asking: "Working",
        thinking: "Thinking",
        finalizing: "Finalizing",
        preparingProposal: "Preparing proposal",
        reviewingChanges: "Reviewing changes",
        canceled: "Canceled by user",
        applied: "Applied reviewed changes",
        created: "Created reviewed document"
      }
    },
    toast: {
      dismiss: "Dismiss"
    },
    workspaceMessages: {
      launchWorkspaceFallback: "Unable to read launch workspace.",
      missingWorkspace: "The last workspace is no longer available. Choose a folder to continue.",
      readWorkspaceFallback: "Unable to read workspace.",
      recentMissing: "That folder is no longer available."
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
      moveToTrashFallback: "Unable to move item to Trash.",
      copyPathFallback: "Unable to copy path.",
      copiedPath: "Copied path.",
      revealInFinderFallback: "Unable to reveal item.",
      openLinkFallback: "Unable to open link.",
      createdFileMissing: "Created file was not found after refreshing the workspace.",
      createdFolderMissing: "Created folder was not found after refreshing the workspace.",
      renamedFileMissing: "Renamed file was not found after refreshing the workspace.",
      duplicatedFileMissing: "Duplicated file was not found after refreshing the workspace.",
      openMarkdownBeforeImages: "Open a Markdown document before adding images.",
      savedImage: (relativePath: string) => `Saved image to ${relativePath}`,
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
        error: "Error"
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
      newFolder: "Nueva carpeta",
      changeFolder: "Cambiar carpeta",
      openFolder: "Abrir carpeta…",
      recent: "Recientes",
      noFiles: "Sin archivos",
      pendingEdit: (path: string) => `Edición pendiente: ${path}`,
      proposedNewDocument: (path: string) => `Documento nuevo propuesto: ${path}`,
      rename: (name: string) => `Renombrar ${name}`
    },
    treeContextMenu: {
      duplicate: "Duplicar",
      rename: "Renombrar",
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
        action: "Ajustar",
        working: "Ajustando…",
        alreadyTight: "Ya está conciso",
        failed: "No se pudo ajustar; inténtalo de nuevo",
        noKey: "Conecta Codex o añade una clave de OpenAI en el asistente para ajustar",
        tooLong: "Selección demasiado larga para ajustar",
        editAction: "Editar",
        editComposerLabel: "Editar la selección",
        editComposerPlaceholder: "Describe el cambio…",
        editWorking: "Editando…",
        editUnchanged: "Sin cambios",
        editFailed: "No se pudo editar; inténtalo de nuevo",
        editNoKey: "Conecta Codex o añade una clave de OpenAI en el asistente para editar",
        editTooLong: "Selección o instrucción demasiado larga para editar"
      },
      reviewToolbar: {
        changes: (count: number) => (count === 1 ? "1 cambio" : `${count} cambios`),
        previous: "Cambio anterior",
        next: "Cambio siguiente",
        acceptAll: "Aceptar todo",
        rejectAll: "Rechazar todo",
        rejectRemaining: "Rechazar restante",
        create: "Crear",
        discard: "Descartar",
        stale: "Obsoleto",
        acceptChange: "Aceptar",
        rejectChange: "Rechazar",
        pendingDocument: (path: string) => `Documento pendiente: ${path}`
      }
    },
    assistant: {
      title: "Agente",
      open: "Abrir agente",
      close: "Cerrar agente",
      newChat: "Nuevo chat",
      history: {
        title: "Historial",
        back: "Volver al chat",
        loading: "Cargando historial",
        empty: "Sin conversaciones guardadas",
        clear: "Borrar historial",
        clearConfirm: "Borrar el historial de chat guardado para este espacio de trabajo?",
        groups: {
          today: "Hoy",
          yesterday: "Ayer",
          thisWeek: "Esta semana",
          older: "Anterior"
        }
      },
      settings: "Ajustes del agente",
      noActiveFile: "Sin archivo",
      missingKey: "Conecta Codex o agrega una clave API de OpenAI antes de preguntar al agente.",
      connection: "Conexión",
      apiKey: "Clave API de OpenAI",
      apiKeyActive: "Activa",
      apiKeySaved: "Guardada",
      apiKeyPlaceholder: "sk-...",
      apiKeyHelper: "Se guarda localmente. El uso de la API es independiente de los planes de ChatGPT.",
      getApiKey: "Obtener una clave API",
      changeKey: "Cambiar clave",
      apiKeyRole: "Chat, edición y dictado.",
      powersChat: "Potencia el chat",
      powersDictation: "Potencia el dictado",
      modelSection: "Modelo",
      model: "Modelo del agente",
      modelHelper: "Modelos compatibles con Codex. Se recomienda gpt-5.5.",
      mode: "Modo",
      saveSettings: "Guardar ajustes",
      send: "Enviar",
      stop: "Detener",
      dictation: {
        dictate: "Dictar",
        stopRecording: "Detener grabación",
        transcribing: "Transcribiendo",
        recording: "Grabando",
        couldNotTranscribe: "No se pudo transcribir",
        stopBeforeSending: "Detén la grabación antes de enviar",
        unsupported: "El dictado con micrófono no está disponible",
        errors: {
          microphoneDenied: "No se permitió usar el micrófono",
          noSpeechDetected: "No se detectó voz",
          recordingTooLong: "La grabación es demasiado larga",
          missingApiKey: "Agrega una clave API de OpenAI para dictar"
        }
      },
      codex: {
        title: "Codex",
        role: "Plan de ChatGPT.",
        checking: "Revisando",
        notConnected: "Sin conexión",
        connecting: "Conectando",
        connected: "Conectado",
        unavailable: "No disponible",
        futureRuntime: "El chat usa Codex cuando está conectado.",
        currentChatUsesApiKey: "El dictado usa la API de OpenAI.",
        connectedCopy: "El chat usa Codex.",
        dictationUsesApiKey: "El dictado usa la API de OpenAI.",
        disconnectedCopy: "Conecta Codex o usa una clave API de OpenAI para el chat.",
        connect: "Conectar Codex",
        openOpenAI: "Abrir OpenAI",
        cancel: "Cancelar",
        disconnect: "Desconectar",
        refresh: "Actualizar",
        deviceUrl: "Ve a auth.openai.com/codex/device",
        copyCode: "Copiar código",
        deviceAuthorizationHelp:
          "Si OpenAI lo solicita, activa la autorización por código de dispositivo en la configuración de seguridad de ChatGPT.",
        signedInAs: (email: string) => `Conectado como ${email}`,
        plan: (plan: string) => `Plan: ${plan}`,
        rateLimit: (percent: number, windowDurationMins: number | null) =>
          windowDurationMins ? `${percent}% usado en ventana de ${windowDurationMins} min` : `${percent}% usado`,
        unavailableCopy: "Codex no está disponible.",
        cliNotFound: "No se encontró Codex CLI.",
        errorFallback: "No se pudo actualizar la conexión Codex. Intenta de nuevo."
      },
      remote: {
        section: "Acceso remoto",
        title: "Telegram",
        checking: "Revisando",
        disabled: "Desactivado",
        enabled: "Activado",
        paired: "Vinculado",
        unpaired: "Sin vincular",
        role: "Pregunta desde Telegram.",
        privacyCopy:
          "Los mensajes de Telegram y las respuestas de Iliad pasan por Telegram. Los archivos Markdown quedan en este computador salvo que una respuesta los cite o resuma.",
        readOnlyCopy:
          "El chat remoto puede responder preguntas con fuentes. No puede editar archivos ni aprobar cambios.",
        enable: "Activar",
        disable: "Desactivar",
        pair: "Vincular",
        revoke: "Revocar",
        pairingLink: "Enlace de vinculación",
        pairingCode: "Código de vinculación",
        copyLink: "Copiar enlace",
        copyCode: "Copiar código",
        openLink: "Abrir enlace",
        expiresAt: (date: string) => `Expira ${date}`,
        setupRequired: "Configura una URL de relay de Telegram antes de vincular.",
        secureUrlRequired: "Configura una URL segura de relay de Telegram antes de conectar.",
        pairingUnavailable: "La vinculación del chat remoto de Telegram no está disponible en esta versión.",
        pairedWith: (name: string) => `Vinculado con ${name}`,
        pairedAt: (date: string) => `Vinculado ${date}`,
        iliadChat: (title: string) => `Chat de Iliad: ${title}`,
        defaultRemoteChat: "Chat remoto predeterminado",
        thisChat: "Este chat",
        selectedChat: "Chat seleccionado",
        useThisChat: "Usar este chat",
        errorFallback: "No se pudo actualizar la configuración del chat remoto de Telegram. Intenta de nuevo."
      },
      promptPlaceholder: "Pregunta lo que quieras...",
      promptPlaceholderNoFile: "Pregunta lo que quieras...",
      promptRequired: "Escribe una instrucción primero.",
      selectionComments: {
        chip: (count: number, name: string) =>
          count === 1 ? `1 comentario · ${name}` : `${count} comentarios · ${name}`,
        openList: "Mostrar comentarios pendientes",
        listLabel: "Comentarios pendientes",
        noAnchor: "sin ancla",
        discard: "Descartar comentario",
        scrollTo: (excerpt: string) => `Ir a "${excerpt}"`,
        disclosure: (count: number) => (count === 1 ? "1 comentario" : `${count} comentarios`)
      },
      patchReady: "Reemplazo revisable listo",
      documentReady: "Nuevo documento listo",
      pendingChanges: "Cambios pendientes",
      filesChanged: (count: number) => (count === 1 ? "1 archivo" : `${count} archivos`),
      review: "Revisar",
      reviewChanges: "Revisar cambios",
      reviewDocument: "Revisar documento",
      apply: "Aplicar",
      discard: "Descartar",
      noTextResponse: "El agente no devolvió texto.",
      errorFallback: "Falló la solicitud al agente.",
      fileChanged: "Vuelve a abrir el documento original antes de aplicar esta propuesta.",
      context: {
        label: "Contexto del próximo mensaje",
        auto: "Auto",
        autoTooltip: "Auto usa el archivo actual y el acceso al espacio de trabajo disponible para esta ejecución.",
        currentFileTooltip: (path: string) => `Contexto del archivo actual: ${path}`,
        manualTooltip: (path: string) => `Archivo adjunto como contexto: ${path}`,
        remove: (path: string) => `Quitar ${path} del contexto`,
        attached: (path: string) => `${path} adjunto al contexto`,
        removed: (path: string) => `${path} quitado del contexto`,
        alreadyAttached: (path: string) => `${path} ya está adjunto`,
        maxManualAttachments: (limit: number) => `El contexto manual está limitado a ${limit} archivos`,
        suggestionsLabel: "Archivos Markdown para adjuntar",
        attachSuggestion: (path: string) => `Adjuntar ${path} al contexto`,
        noMatchingMarkdown: "No hay archivos Markdown coincidentes",
        keepTypingToNarrow: "Sigue escribiendo para acotar resultados",
        dropRejected: "Suelta un archivo Markdown de este espacio de trabajo",
        noFileIncluded: "Sin archivo incluido",
        currentFile: "Archivo actual",
        workspaceAccess: "Acceso al espacio de trabajo",
        workspaceFiles: "Archivos del espacio de trabajo",
        excludedWorkspace: "Otros archivos del espacio de trabajo excluidos",
        included: "Incluido",
        available: "Disponible",
        excluded: "Excluido",
        reference: "Referencia",
        resultCount: (count: number) => (count === 1 ? "1 resultado" : `${count} resultados`),
        searchedPaths: (count: number) => (count === 1 ? "1 ruta revisada" : `${count} rutas revisadas`),
        searchedFiles: (count: number) => (count === 1 ? "1 archivo revisado" : `${count} archivos revisados`),
        truncated: "búsqueda limitada",
        documentList: "Lista de documentos",
        documentSearch: "Búsqueda de documentos",
        documentReadFailed: "Lectura de documento fallida",
        historyOmitted: (count: number) =>
          count === 1
            ? "1 mensaje anterior no enviado (presupuesto de historial)"
            : `${count} mensajes anteriores no enviados (presupuesto de historial)`,
        summaryUsed: (count: number) =>
          count === 1 ? "Resumen de 1 mensaje anterior" : `Resumen de ${count} mensajes anteriores`,
        selection: (lineStart: number, lineEnd: number) =>
          lineStart === lineEnd ? `Selección (línea ${lineStart})` : `Selección (líneas ${lineStart}-${lineEnd})`,
        selectionChip: (lineStart: number, lineEnd: number) =>
          lineStart === lineEnd ? `Selección · línea ${lineStart}` : `Selección · líneas ${lineStart}-${lineEnd}`,
        removeSelection: "Omitir la selección en este mensaje",
        workspaceRules: "Reglas del workspace",
        referencedEarlier: (count: number) =>
          count === 1
            ? "1 documento referenciado antes en esta conversación"
            : `${count} documentos referenciados antes en esta conversación`,
        provider: (provider: string, model: string) => `${provider} · ${model}`
      },
      activity: {
        label: "Actividad del agente",
        started: "Iniciado",
        completed: "Listo",
        failed: "Falló",
        documentList: "Listando documentos",
        documentSearch: "Buscando documentos",
        documentSearchQuery: (query: string) => `Buscando documentos para "${query}"`,
        documentRead: (path: string) => `Leyendo ${path}`,
        documentReadGeneric: "Leyendo documento",
        documentOpen: (path: string) => `Abriendo ${path}`,
        documentOpenGeneric: "Abriendo documento",
        documentReadFailed: (path: string) => `No se pudo leer ${path}`,
        documentReadFailedGeneric: "No se pudo leer el documento"
      },
      receipt: {
        process: "Proceso",
        attachments: "Archivos adjuntos en este mensaje",
        reads: (count: number) => (count === 1 ? "Leyó 1 documento" : `Leyó ${count} documentos`),
        searches: (count: number) => (count === 1 ? "1 búsqueda" : `${count} búsquedas`),
        opens: (count: number) => (count === 1 ? "Abrió 1 documento" : `Abrió ${count} documentos`),
        readsFailed: (count: number) => (count === 1 ? "1 lectura fallida" : `${count} lecturas fallidas`),
        documentList: "Listó documentos",
        documentSearch: "Buscó documentos",
        documentSearchQuery: (query: string) => `Buscó documentos para "${query}"`,
        documentRead: (path: string) => `Leyó ${path}`,
        documentReadGeneric: "Leyó documento",
        documentOpen: (path: string) => `Abrió ${path}`,
        documentOpenGeneric: "Abrió documento",
        documentReadFailed: (path: string) => `No se pudo leer ${path}`,
        documentReadFailedGeneric: "No se pudo leer el documento"
      },
      errors: {
        missing_api_key: "Conecta Codex o agrega una clave API de OpenAI antes de preguntar al agente.",
        invalid_api_key: "OpenAI rechazó la clave API guardada. Revisa la clave.",
        rate_limited: "OpenAI limitó esta solicitud. Intenta de nuevo en un momento.",
        provider_unavailable: "El motor del agente no está disponible ahora. Intenta de nuevo en un momento.",
        network_unreachable: "No se pudo conectar con OpenAI. Revisa tu conexión e intenta de nuevo.",
        dns_failure: "No se pudo conectar con OpenAI. Revisa tu internet o DNS e intenta de nuevo.",
        request_timeout: "La solicitud tardó demasiado. Intenta de nuevo.",
        request_canceled: "Cancelado.",
        model_not_found: "No se encontró el modelo seleccionado. Revisa el nombre en ajustes.",
        malformed_provider_response: "OpenAI devolvió una respuesta inesperada. Intenta de nuevo.",
        unknown: "Falló la solicitud al agente. Intenta de nuevo."
      },
      modes: {
        fast: "Rápido",
        balanced: "Equilibrado",
        deep: "Profundo"
      },
      proposalStatus: {
        pending: "Pendiente",
        partially_applied: "Parcialmente aplicado",
        applied: "Aplicado",
        rejected: "Rechazado",
        stale: "Obsoleto",
        failed: "Fallido"
      },
      status: {
        reading: "Leyendo contexto",
        asking: "Trabajando",
        thinking: "Pensando",
        finalizing: "Finalizando",
        preparingProposal: "Preparando propuesta",
        reviewingChanges: "Revisando cambios",
        canceled: "Cancelado por el usuario",
        applied: "Cambios revisados aplicados",
        created: "Documento revisado creado"
      }
    },
    toast: {
      dismiss: "Cerrar"
    },
    workspaceMessages: {
      launchWorkspaceFallback: "No se pudo leer el espacio de trabajo de inicio.",
      missingWorkspace: "El último espacio de trabajo ya no está disponible. Elige una carpeta para continuar.",
      readWorkspaceFallback: "No se pudo leer el espacio de trabajo.",
      recentMissing: "Esa carpeta ya no está disponible."
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
      moveToTrashFallback: "No se pudo mover el elemento a la papelera.",
      copyPathFallback: "No se pudo copiar la ruta.",
      copiedPath: "Ruta copiada.",
      revealInFinderFallback: "No se pudo mostrar el elemento.",
      openLinkFallback: "No se pudo abrir el enlace.",
      createdFileMissing: "El archivo creado no apareció al actualizar el espacio de trabajo.",
      createdFolderMissing: "La carpeta creada no apareció al actualizar el espacio de trabajo.",
      renamedFileMissing: "El archivo renombrado no apareció al actualizar el espacio de trabajo.",
      duplicatedFileMissing: "El archivo duplicado no apareció al actualizar el espacio de trabajo.",
      openMarkdownBeforeImages: "Abre un documento Markdown antes de agregar imágenes.",
      savedImage: (relativePath: string) => `Imagen guardada en ${relativePath}`,
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
