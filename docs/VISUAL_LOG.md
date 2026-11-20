# Visual Feature & Commit Log (`VISUAL_LOG.md`)
> **1-Line Summary:** Visual Obsidian-compatible Mermaid flowcharts and plain-English architectural breakdowns for features and system revisions.

## 1. Feature & Milestone Progression

### [LOG: Phase-1-Security-Hardening] | Aliases: security hardening, origin pinning, symlink guard, ssrf, xss
> **1-Line Summary:** Locks down the local loopback service and browser extension against symlink escapes, unauthorized origins, and SSRF.

* **Plain-English Explanation:** The local HTTP service now requires explicit origin pinning (matching `chrome-extension://` IDs) and uses `fs.realpathSync` to ensure note and asset writes cannot climb outside the Obsidian vault via directory symlinks or junctions. Remote image downloads validate target addresses to block SSRF into loopback or internal metadata IP ranges, and PowerShell directory selection arguments are strictly validated.

```mermaid
flowchart TD
    classDef client fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef security fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#e65100;
    classDef vault fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#1b5e20;
    classDef blocked fill:#ffebee,stroke:#d32f2f,stroke-width:2px,color:#b71c1c;

    Ext[Extension Request]:::client -->|POST /rpc + Origin Header| CheckOrigin{Valid Extension Origin?}:::security
    CheckOrigin -->|No / Unknown Origin| Reject403[403 Forbidden]:::blocked
    CheckOrigin -->|Yes| ResolvePath[Resolve Real Path with fs.realpathSync]:::security
    ResolvePath --> CheckSymlink{Escapes Vault Root?}:::security
    CheckSymlink -->|Yes| RefuseSymlink[Refuse Write Outside Vault]:::blocked
    CheckSymlink -->|No| SafeWrite[Write Note & Assets to Vault]:::vault

    subgraph Legend ["Legend / Status Box"]
        L1[Client Request]:::client
        L2[Security Boundary Check]:::security
        L3[Permitted Vault Storage]:::vault
        L4[Rejected / Blocked Call]:::blocked
    end
```

---

### [LOG: Phase-2-Core-Bugs-And-Concurrency] | Aliases: concurrency locks, mv3 state, caching, turndown
> **1-Line Summary:** Solves MV3 background worker eviction races, enforces in-flight concurrency locks, and fixes extractor edge cases.

* **Plain-English Explanation:** Manifest V3 background service workers can shut down at any time. State is now persisted across worker lifecycles, and concurrent save/export operations for the same active tab are locked to prevent duplicate writes or collisions. Extractor edge cases in Turndown HTML parsing and image stashing are cleanly resolved.

```mermaid
flowchart LR
    classDef trigger fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef worker fill:#ede7f6,stroke:#512da8,stroke-width:2px,color:#311b92;
    classDef storage fill:#fffde7,stroke:#fbc02d,stroke-width:2px,color:#f57f17;
    classDef lock fill:#ffebee,stroke:#d32f2f,stroke-width:2px,color:#b71c1c;

    UserClick[User Clicks Save]:::trigger --> CheckInFlight{Tab Already In-Flight?}:::worker
    CheckInFlight -->|Yes| DropDupe[Prevent Duplicate Trigger]:::lock
    CheckInFlight -->|No| AcquireLock[Acquire Tab Mutex Lock]:::worker
    AcquireLock --> SyncState[Load Cached Settings from chrome.storage]:::storage
    SyncState --> RunPipeline[Run Extraction & Note Build]:::worker
    RunPipeline --> ReleaseLock[Release Lock & Return Status]:::worker

    subgraph Legend ["Legend / Flow Details"]
        Leg1[User Trigger]:::trigger
        Leg2[Worker Execution]:::worker
        Leg3[State Cache]:::storage
        Leg4[Concurrency Lock]:::lock
    end
```

---

### [LOG: Phase-3-UI-Accessibility-And-Contrast] | Aliases: wcag contrast, options layout, responsive popup, a11y
> **1-Line Summary:** Polishes user interface contrast across themes and optimizes options and popup layouts for accessibility.

* **Plain-English Explanation:** Options and popup pages are overhauled to guarantee WCAG AA/AAA contrast ratios in both Light and Dark modes. Keyboard focus indicators, form control labels, and ARIA live regions ensure fully accessible screen-reader navigation and status updates.

```mermaid
flowchart TD
    classDef theme fill:#e0f2f1,stroke:#00796b,stroke-width:2px,color:#004d40;
    classDef a11y fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#4a148c;
    classDef ui fill:#e8eaf6,stroke:#303f9f,stroke-width:2px,color:#1a237e;

    DOM[Extension Popup / Options DOM]:::ui --> ThemeCheck{Theme Preference}:::theme
    ThemeCheck -->|Dark Theme| DarkTokens[Calibrated WCAG AAA High Contrast Dark Tokens]:::theme
    ThemeCheck -->|Light Theme| LightTokens[Calibrated WCAG AAA Contrast Light Tokens]:::theme
    DarkTokens --> RenderUI[Render Accessible Surfaces]:::ui
    LightTokens --> RenderUI
    RenderUI --> A11yCheck[ARIA Live Regions + Clear Focus Rings]:::a11y

    subgraph Legend ["Legend / Accessibility Components"]
        LegTheme[Color Theme Tokens]:::theme
        LegUI[UI Rendering]:::ui
        LegA11y[Accessibility Enforcement]:::a11y
    end
```

---

### [LOG: Phase-4-Scope-Parity-And-Dead-Code-Pruning] | Aliases: scope parity, dead code pruning, on-demand injection
> **1-Line Summary:** Prunes legacy unused scripts and switches content scripts to on-demand programmatic injection.

* **Plain-English Explanation:** Dead vendor code (`readability-readerable.js`) and dropped features are removed. Instead of permanently injecting content scripts into every open tab in the browser on startup, scripts are injected programmatically on-demand only when a clip is requested on the active tab.

```mermaid
flowchart LR
    classDef action fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef system fill:#eceff1,stroke:#455a64,stroke-width:2px,color:#263238;
    classDef clean fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#1b5e20;

    ClipAction[User Triggers Clip Action]:::action --> CheckInjected{Content Script Injected?}:::system
    CheckInjected -->|No| InjectOnDemand[chrome.scripting.executeScript CONTENT_FILES]:::action
    CheckInjected -->|Yes| Extract[Execute In-Tab Extraction]:::clean
    InjectOnDemand --> Extract
    Extract --> CleanModel[Clean Clip Object Returned]:::clean

    subgraph Legend ["Legend / Architectural Nodes"]
        LA[Action Initiation]:::action
        LS[System Evaluation]:::system
        LC[Clean Core Output]:::clean
    end
```

---

### [LOG: Phase-5-QoL-And-Lateral-Features] | Aliases: shortcuts, side panel, dup check, preview tiling, selection clip
> **1-Line Summary:** Adds keyboard shortcuts, side panel reader mode, live Markdown preview tiling, duplicate note warnings, and selection clipping.

* **Plain-English Explanation:** Users can now clip highlighted text directly without saving the whole page, check the vault via `opExists` for existing notes to avoid unexpected overwrites, view live Markdown previews side-by-side in a persistent side panel, and trigger actions with keyboard shortcuts.

```mermaid
flowchart TD
    classDef input fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b;
    classDef feature fill:#fff8e1,stroke:#ffa000,stroke-width:2px,color:#ff6f00;
    classDef vault fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#1b5e20;

    InputMode{Input Trigger}:::input -->|Shortcut / Action| CheckSelection{Text Selected on Page?}:::feature
    CheckSelection -->|Yes| SelClip[Selection Clip Mode]:::feature
    CheckSelection -->|No| FullClip[Full Page Adapter]:::feature

    SelClip --> BuildNote[Build Note]:::feature
    FullClip --> BuildNote

    BuildNote --> CheckDup[Call opExists via Local Service]:::feature
    CheckDup --> ShowPreview[Render Live Tiled Preview & Status]:::feature
    ShowPreview --> UserSave[Save Confirmed -> Vault Output]:::vault

    subgraph Legend ["Legend / Pipeline Stages"]
        Lin[Trigger Input]:::input
        Lfeat[Feature Handling]:::feature
        Lvault[Final Vault Persistence]:::vault
    end
```
