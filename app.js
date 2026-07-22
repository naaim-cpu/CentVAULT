(() => {
  const DATA_ROOT = "data/";
  const DATA_VERSION = "20260722-1933";
  const TARGET_COUNTS = {
    "Writing Banks": 9,
    "Peril Playbooks": 22,
    "Policy & Clauses": 33,
    "Investigation & Reference": 5,
    "Templates & Tools": 4,
  };
  const INVESTIGATION_TITLES = [
    "Claim Documents Required",
    "ADJUSTER CHECKLIST",
    "Interim Payment",
    "VRS Insurance Workspace",
    "Supp Report Combined",
  ];

  const state = {
    documents: [],
    query: "",
    category: "",
    view: "table",
    limit: 18,
    sortKey: "title",
    sortDirection: 1,
    passages: null,
    passagePromise: null,
    documentBundle: null,
    documentBundlePromise: null,
    selected: null,
    chunk: 0,
    chunkContent: "",
    outlineOpen: true,
  };

  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const normalize = (value) => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const compact = (value) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
  const assetUrl = (name) => `${DATA_ROOT}${String(name).split("/").map(encodeURIComponent).join("/")}?v=${DATA_VERSION}`;
  const debounce = (callback, delay = 220) => {
    let timer;
    return (...arguments_) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...arguments_), delay);
    };
  };

  async function loadJson(name) {
    const response = await fetch(assetUrl(name));
    if (!response.ok) throw new Error(`Could not load ${name}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function loadDocumentChunk(documentId, chunkIndex) {
    if (!state.documentBundlePromise) {
      state.documentBundlePromise = loadJson("documents.json").then((bundle) => {
        state.documentBundle = bundle;
        return bundle;
      });
    }
    const bundle = await state.documentBundlePromise;
    const chunk = bundle[`${documentId}-${chunkIndex}`];
    if (!chunk) throw new Error("Could not load this source part");
    return chunk;
  }

  function parseQuery(raw) {
    const include = [];
    const exclude = [];
    const matcher = /(-?)"([^"]+)"|(-?)(\S+)/g;
    let match;
    while ((match = matcher.exec(raw)) !== null) {
      const token = (match[2] || match[4] || "").trim();
      if (!token) continue;
      const item = { raw: token, normalized: normalize(token), phrase: Boolean(match[2]) };
      (match[1] === "-" || match[3] === "-" ? exclude : include).push(item);
    }
    return { include, exclude };
  }

  function regexEscape(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(text, terms) {
    let output = escapeHtml(text);
    [...new Set(terms.map((term) => term.raw).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .forEach((word) => {
        output = output.replace(new RegExp(`(${regexEscape(escapeHtml(word))})`, "ig"), "<mark>$1</mark>");
      });
    return output;
  }

  function curateDocuments(index) {
    const byTitle = (a, b) => a.title.localeCompare(b.title);
    const selected = [];
    Object.entries(TARGET_COUNTS).forEach(([category, target]) => {
      const categoryDocuments = index.documents.filter((document) => document.category === category).sort(byTitle);
      if (category !== "Investigation & Reference") {
        selected.push(...categoryDocuments.slice(0, target));
        return;
      }

      const chosen = [];
      INVESTIGATION_TITLES.forEach((fragment) => {
        const match = categoryDocuments.find((document) => normalize(document.title).includes(normalize(fragment)) && !chosen.includes(document));
        if (match) chosen.push(match);
      });
      categoryDocuments.forEach((document) => {
        if (chosen.length < target && !chosen.includes(document) && document.wordCount > 100) chosen.push(document);
      });
      selected.push(...chosen.slice(0, target));
    });
    return selected.sort(byTitle);
  }

  function filteredDocuments() {
    const parsed = parseQuery(state.query);
    const filtered = state.documents.filter((document) => {
      if (state.category && document.category !== state.category) return false;
      const haystack = normalize(document.searchText || `${document.title} ${document.relativePath} ${document.excerpt || ""}`);
      if (parsed.exclude.some((term) => haystack.includes(term.normalized))) return false;
      return parsed.include.every((term) => haystack.includes(term.normalized));
    });

    const direction = state.sortDirection;
    return filtered.sort((a, b) => {
      let left = a[state.sortKey];
      let right = b[state.sortKey];
      if (typeof left === "string") return left.localeCompare(right) * direction;
      return ((left || 0) - (right || 0)) * direction;
    });
  }

  function sortArrow(key) {
    if (state.sortKey !== key) return "";
    return state.sortDirection === 1 ? "↑" : "↓";
  }

  function renderFilters() {
    document.querySelectorAll("[data-category]").forEach((button) => {
      button.classList.toggle("active", button.dataset.category === state.category);
    });
  }

  function renderTable(documents) {
    return `
      <div class="dataview-table">
        <div class="dataview-caption"><span>LIVE VAULT INDEX</span><small>Sort any column · select a source to open its Outline</small></div>
        <div class="dataview-scroll">
          <table>
            <thead><tr>
              <th class="dataview-number">#</th>
              <th><button data-sort="title" type="button">Source ${sortArrow("title")}</button></th>
              <th><button data-sort="category" type="button">Knowledge area ${sortArrow("category")}</button></th>
              <th><button data-sort="sectionCount" type="button">Sections ${sortArrow("sectionCount")}</button></th>
              <th><button data-sort="wordCount" type="button">Words ${sortArrow("wordCount")}</button></th>
              <th><span class="sr-only">Open</span></th>
            </tr></thead>
            <tbody>${documents.map((document, index) => `
              <tr>
                <td class="dataview-number">${String(index + 1).padStart(2, "0")}</td>
                <td><button class="dataview-source" data-document="${document.id}" type="button"><strong>${escapeHtml(document.title)}</strong><small>${escapeHtml(document.relativePath)}</small></button></td>
                <td><span class="dataview-category"><i></i>${escapeHtml(document.category)}</span></td>
                <td>${document.sectionCount || 0}</td>
                <td>${compact(document.wordCount)}</td>
                <td><button class="dataview-open" data-document="${document.id}" type="button" aria-label="Open ${escapeHtml(document.title)}">↗</button></td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderCards(documents) {
    return `<div class="document-grid">${documents.map((document, index) => `
      <button class="document-card" data-document="${document.id}" type="button">
        <span class="document-card-top"><span>${String(index + 1).padStart(2, "0")}</span><i>↗</i></span>
        <small>${escapeHtml(document.category)}</small>
        <h4>${escapeHtml(document.title)}</h4>
        <p>${escapeHtml(document.excerpt || document.relativePath)}</p>
        <span class="document-meta"><span>${document.sectionCount || 0} sections</span><span>${compact(document.wordCount)} words</span></span>
      </button>`).join("")}</div>`;
  }

  function renderLibrary() {
    const documents = filteredDocuments();
    const shown = documents.slice(0, state.limit);
    el("resultCount").textContent = `${documents.length} result${documents.length === 1 ? "" : "s"}`;
    renderFilters();

    if (!shown.length) {
      el("libraryContent").className = "empty-results";
      el("libraryContent").innerHTML = `<span>⌕</span><h4>No exact match</h4><p>Try fewer words or choose another knowledge area.</p><button id="resetSearch" type="button">Clear search</button>`;
      el("resetSearch").onclick = clearSearch;
    } else {
      el("libraryContent").className = "";
      el("libraryContent").innerHTML = state.view === "table" ? renderTable(shown) : renderCards(shown);
      el("libraryContent").querySelectorAll("[data-document]").forEach((button) => {
        button.onclick = () => openDocument(button.dataset.document);
      });
      el("libraryContent").querySelectorAll("[data-sort]").forEach((button) => {
        button.onclick = () => {
          const key = button.dataset.sort;
          if (state.sortKey === key) state.sortDirection *= -1;
          else {
            state.sortKey = key;
            state.sortDirection = 1;
          }
          renderLibrary();
        };
      });
    }

    const hasMore = shown.length < documents.length;
    el("loadMore").classList.toggle("hidden", !hasMore);
    el("loadMore").innerHTML = `Show all ${documents.length} sources <span>↓</span>`;
  }

  function passageSnippet(passage, terms) {
    const normalized = normalize(passage.text);
    const positions = terms.map((term) => normalized.indexOf(term.normalized)).filter((position) => position >= 0);
    if (!positions.length || passage.text.length <= 390) return passage.text;
    const first = Math.min(...positions);
    const last = Math.max(...positions);
    let start = Math.max(0, first - 125);
    let end = Math.min(passage.text.length, Math.max(last + 185, start + 390));
    if (start > 0) start = passage.text.indexOf(" ", start) + 1 || start;
    if (end < passage.text.length) end = passage.text.lastIndexOf(" ", end);
    return `${start > 0 ? "…" : ""}${passage.text.slice(start, end)}${end < passage.text.length ? "…" : ""}`;
  }

  function rankPassage(passage, document, parsed) {
    const text = normalize(passage.text);
    const heading = normalize(passage.heading);
    const title = normalize(document.title);
    const haystack = `${heading} ${text} ${title}`;
    if (parsed.exclude.some((term) => haystack.includes(term.normalized))) return -1;
    if (!parsed.include.every((term) => haystack.includes(term.normalized))) return -1;
    const positions = parsed.include.map((term) => text.indexOf(term.normalized)).filter((position) => position >= 0);
    const span = positions.length > 1 ? Math.max(...positions) - Math.min(...positions) : 0;
    const headingScore = parsed.include.reduce((score, term) => score + (heading.includes(term.normalized) ? 50 : 0) + (title.includes(term.normalized) ? 25 : 0), 0);
    return 1000 + headingScore + Math.max(0, 260 - span);
  }

  async function ensurePassages() {
    if (state.passagePromise) return state.passagePromise;
    state.passagePromise = loadJson("passages.json").then((data) => {
      state.passages = Array.isArray(data) ? data : data.passages || [];
      return state.passages;
    });
    return state.passagePromise;
  }

  async function renderPassages() {
    const parsed = parseQuery(state.query);
    const visible = parsed.include.length > 0;
    el("passageResults").classList.toggle("hidden", !visible);
    if (!visible) return;

    el("passageCount").textContent = "Searching passages…";
    el("passageList").innerHTML = '<div class="passage-skeleton"><i></i><i></i><i></i></div>';
    try {
      await ensurePassages();
      const documents = new Map(state.documents.map((document) => [document.id, document]));
      const matches = state.passages
        .map((passage) => ({ passage, document: documents.get(passage.documentId) }))
        .filter((item) => item.document && (!state.category || item.document.category === state.category))
        .map((item) => ({ ...item, score: rankPassage(item.passage, item.document, parsed) }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title))
        .slice(0, 12);

      el("passageCount").textContent = `${matches.length} closest match${matches.length === 1 ? "" : "es"}`;
      if (!matches.length) {
        el("passageList").innerHTML = '<div class="passage-message">No sentence contains every word. Try fewer words or check the spelling.</div>';
        return;
      }

      el("passageList").innerHTML = matches.map((item, index) => `
        <button data-passage="${index}" type="button">
          <span class="passage-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="passage-copy"><small>${escapeHtml(item.document.category)}${item.passage.heading ? ` / ${escapeHtml(item.passage.heading)}` : ""}</small><strong>${escapeHtml(item.document.title)}</strong><p>${highlight(passageSnippet(item.passage, parsed.include), parsed.include)}</p></span>
          <span class="passage-open">Open passage</span>
        </button>`).join("");
      el("passageList").querySelectorAll("[data-passage]").forEach((button) => {
        button.onclick = () => {
          const item = matches[Number(button.dataset.passage)];
          openDocument(item.document.id, item.passage.chunkIndex || 0);
        };
      });
    } catch (error) {
      el("passageCount").textContent = "Search unavailable";
      el("passageList").innerHTML = `<div class="passage-message error">${escapeHtml(error.message)}</div>`;
    }
  }

  function cleanMarkdown(content) {
    return String(content || "")
      .replace(/<font[^>]*>/gi, "")
      .replace(/<\/font>/gi, "")
      .replace(/!\[\[([^\]]+)\]\]/g, "Attachment: $1")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1");
  }

  function openReader(source, chunk = 0) {
    state.selected = source;
    state.chunk = Math.min(Math.max(chunk, 0), Math.max(0, source.chunkCount - 1));
    el("readerCategory").textContent = source.category;
    el("readerTitle").textContent = source.title;
    el("readerPath").textContent = source.relativePath;
    el("readerMeta").textContent = `${compact(source.wordCount)} words / ${source.sectionCount || 0} headings`;
    el("outlineSearch").value = "";
    el("clearOutline").classList.add("hidden");
    el("readerBackdrop").classList.remove("hidden");
    document.body.classList.add("reader-open");
    el("closeReader").focus();
    loadChunk();
  }

  function openDocument(id, chunk = 0) {
    const document = state.documents.find((item) => item.id === id);
    if (document) openReader(document, chunk);
  }

  async function loadChunk() {
    const document = state.selected;
    if (!document) return;
    el("readerBody").innerHTML = '<div class="reader-loading">Opening source…</div>';
    try {
      const chunk = await loadDocumentChunk(document.id, state.chunk);
      state.chunkContent = chunk.content || "";
      const cleaned = cleanMarkdown(state.chunkContent);
      el("readerBody").innerHTML = cleaned.trim()
        ? (window.marked ? window.marked.parse(cleaned) : `<pre>${escapeHtml(cleaned)}</pre>`)
        : '<div class="empty-note"><span>∅</span><h4>Empty note</h4><p>This part has no text.</p></div>';
      el("readerBody").scrollTop = 0;
      el("partLabel").textContent = `Part ${state.chunk + 1} of ${document.chunkCount}`;
      el("previousPart").disabled = state.chunk === 0;
      el("nextPart").disabled = state.chunk >= document.chunkCount - 1;
      buildOutline();
    } catch (error) {
      el("readerBody").innerHTML = `<div class="reader-error">${escapeHtml(error.message)}</div>`;
    }
  }

  function buildOutline() {
    const headings = [...el("readerBody").querySelectorAll("h1,h2,h3,h4,h5,h6")];
    headings.forEach((heading, index) => {
      heading.id = `source-heading-${index}`;
    });
    el("outlineCount").textContent = `${headings.length} headings`;
    el("outlineNav").innerHTML = headings.length
      ? headings.map((heading, index) => `<button class="outline-level-${Math.min(Number(heading.tagName.slice(1)), 4)}" data-heading="${index}" type="button"><i></i><span>${escapeHtml(heading.textContent)}</span></button>`).join("")
      : "<p>No headings in this part.</p>";
    el("outlineNav").querySelectorAll("[data-heading]").forEach((button) => {
      button.onclick = () => headings[Number(button.dataset.heading)].scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function filterOutline() {
    const query = normalize(el("outlineSearch").value);
    el("clearOutline").classList.toggle("hidden", !query);
    el("outlineNav").querySelectorAll("[data-heading]").forEach((button) => {
      button.hidden = Boolean(query) && !normalize(button.textContent).includes(query);
    });
  }

  function closeReader() {
    el("readerBackdrop").classList.add("hidden");
    document.body.classList.remove("reader-open");
  }

  function findDocument(fragment) {
    const target = normalize(fragment);
    return state.documents.find((document) => normalize(document.title).includes(target))
      || state.documents.find((document) => normalize(document.searchText).includes(target));
  }

  function openMatchedDocument(fragment) {
    const document = findDocument(fragment);
    if (document) openDocument(document.id);
  }

  function setCategory(category) {
    state.category = state.category === category ? "" : category;
    state.limit = 18;
    renderLibrary();
    renderPassages();
    el("library-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearSearch() {
    state.query = "";
    el("vaultSearch").value = "";
    el("clearSearch").classList.add("hidden");
    state.limit = 18;
    renderLibrary();
    renderPassages();
    el("vaultSearch").focus();
  }

  function bindEvents() {
    const updateSearch = debounce(() => {
      state.limit = 18;
      renderLibrary();
      renderPassages();
    });

    el("vaultSearch").addEventListener("input", (event) => {
      state.query = event.target.value;
      el("clearSearch").classList.toggle("hidden", !state.query);
      updateSearch();
    });
    el("clearSearch").onclick = clearSearch;
    el("tableView").onclick = () => {
      state.view = "table";
      el("tableView").classList.add("active");
      el("cardView").classList.remove("active");
      renderLibrary();
    };
    el("cardView").onclick = () => {
      state.view = "cards";
      el("cardView").classList.add("active");
      el("tableView").classList.remove("active");
      renderLibrary();
    };
    el("loadMore").onclick = () => {
      state.limit = Number.MAX_SAFE_INTEGER;
      renderLibrary();
    };
    document.querySelectorAll("[data-category]").forEach((button) => {
      button.onclick = () => setCategory(button.dataset.category);
    });
    el("pinnedSource").onclick = () => openMatchedDocument("Claim Documents Required");
    el("bankShortcuts").querySelectorAll("[data-match]").forEach((button) => {
      button.onclick = () => openMatchedDocument(button.dataset.match);
    });
    el("quickStack").querySelectorAll("[data-match]").forEach((button) => {
      button.onclick = () => openMatchedDocument(button.dataset.match);
    });
    el("closeReader").onclick = closeReader;
    el("readerBackdrop").onclick = (event) => {
      if (event.target === el("readerBackdrop")) closeReader();
    };
    el("previousPart").onclick = () => {
      if (state.chunk > 0) {
        state.chunk -= 1;
        loadChunk();
      }
    };
    el("nextPart").onclick = () => {
      if (state.selected && state.chunk < state.selected.chunkCount - 1) {
        state.chunk += 1;
        loadChunk();
      }
    };
    el("outlineToggle").onclick = () => {
      state.outlineOpen = !state.outlineOpen;
      el("readerOutline").classList.toggle("hidden", !state.outlineOpen);
      el("readerShell").classList.toggle("with-outline", state.outlineOpen);
      el("readerShell").classList.toggle("without-outline", !state.outlineOpen);
      el("outlineToggle").classList.toggle("active", state.outlineOpen);
    };
    el("outlineSearch").addEventListener("input", filterOutline);
    el("clearOutline").onclick = () => {
      el("outlineSearch").value = "";
      filterOutline();
      el("outlineSearch").focus();
    };
    el("copyPart").onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.chunkContent);
        el("copyPart").textContent = "Copied";
      } catch {
        el("copyPart").textContent = "Copy failed";
      }
      setTimeout(() => { el("copyPart").textContent = "Copy this part"; }, 1300);
    };
    document.addEventListener("keydown", (event) => {
      const typing = /input|textarea/i.test(document.activeElement?.tagName || "");
      if ((event.key === "/" && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        el("vaultSearch").focus();
      }
      if (event.key === "Escape" && !el("readerBackdrop").classList.contains("hidden")) closeReader();
    });
  }

  async function start() {
    bindEvents();
    try {
      const index = await loadJson("index.json");
      state.documents = curateDocuments(index);
      el("deskStatus").textContent = `${state.documents.length} sources ready`;
      renderLibrary();
    } catch (error) {
      el("deskStatus").textContent = "Sources unavailable";
      el("libraryContent").className = "desk-error";
      el("libraryContent").textContent = error.message;
    }
  }

  start();
})();
