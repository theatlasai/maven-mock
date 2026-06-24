/* =====================================================================
   Atlas Left Nav — reusable global navigation component
   ---------------------------------------------------------------------
   Self-contained: injects its own (namespaced `anav-*`) styles + markup.
   No build step, no dependencies. Drop into any mockup page:

     <div data-atlas-nav
          data-active="bookkeeping/projects"
          data-client="bright-bloom"></div>
     <script src="assets/atlas-nav.js"></script>

   Or drive it from JS:

     AtlasNav.init(document.querySelector('#nav'), {
       active: 'bookkeeping/projects',
       client: 'bright-bloom',
       user: { name: 'Sarah K.', role: 'Sr. Bookkeeper', initials: 'SK' },
     });

   Structure (per product spec):
     Home → Dashboard (across clients)
     Client dropdown (sections below are client-scoped)
       Bookkeeping → Projects · Recipes · Data
       Taxation    → Projects · Data
     Workflows
     Integrations
     Settings
     Logout

   Events (bubbling CustomEvents on the mount element):
     'atlas-nav:clientchange' → detail: { id, client }
     'atlas-nav:navigate'     → detail: { key, href, label }
   ===================================================================== */
(function (global) {
  "use strict";

  /* ── Defaults (overridable via config) ───────────────────────────── */

  var DEFAULT_CLIENTS = [
    {
      id: "bright-bloom",
      name: "Bright & Bloom LLC",
      initials: "BB",
      tone: "indigo",
    },
    {
      id: "novatech",
      name: "NovaTech Solutions Inc.",
      initials: "NS",
      tone: "blue",
    },
    {
      id: "harbor-cole",
      name: "Harbor & Cole LLP",
      initials: "HC",
      tone: "violet",
    },
    {
      id: "sunrise",
      name: "Sunrise Bakery LLC",
      initials: "SB",
      tone: "amber",
    },
    {
      id: "clearwater",
      name: "Clearwater Clinic",
      initials: "CW",
      tone: "green",
    },
    {
      id: "meridian",
      name: "Meridian Properties",
      initials: "MP",
      tone: "blue",
    },
    { id: "peak", name: "Peak Athletics Co.", initials: "PA", tone: "violet" },
  ];

  var DEFAULT_USER = {
    name: "Sarah K.",
    role: "Sr. Bookkeeper",
    initials: "SK",
  };

  // SVG path data only (kept terse; wrapped at render time).
  var ICON = {
    home: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    bookkeeping:
      "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
    taxation:
      "M9 7h6m-6 4h6m-2 4h2M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z",
    workflows: "M13 10V3L4 14h7v7l9-11h-7z",
    integrations:
      "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z",
    settings:
      "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z|||M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    logout:
      "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
    chevron: "M19 9l-7 7-7-7",
    chevronRight: "M9 5l7 7-7 7",
    search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    check: "M5 13l4 4L19 7",
  };

  // Default destinations. Pages that don't exist yet resolve to '#'.
  var DEFAULT_HREFS = {
    home: "dashboard.html",
    "bookkeeping/projects": "projects-list.html",
    "bookkeeping/recipes": "rules-manager.html",
    "bookkeeping/data": "bookkeeping-data.html",
    "taxation/projects": "projects-list-tax.html",
    "taxation/data": "#",
    workflows: "workflow-live.html",
    integrations: "#",
    settings: "#",
  };

  // Declarative menu model. `scoped: true` marks client-scoped sections.
  var MENU = [
    { key: "home", label: "Dashboard", icon: "home", section: "top" },
    {
      key: "bookkeeping",
      label: "Bookkeeping",
      icon: "bookkeeping",
      scoped: true,
      children: [
        { key: "bookkeeping/projects", label: "Projects" },
        { key: "bookkeeping/recipes", label: "Recipes" },
        { key: "bookkeeping/data", label: "Data" },
      ],
    },
    {
      key: "taxation",
      label: "Taxation",
      icon: "taxation",
      scoped: true,
      children: [
        { key: "taxation/projects", label: "Projects" },
        { key: "taxation/data", label: "Data" },
      ],
    },
    { key: "workflows", label: "Workflows", icon: "workflows", scoped: true },
    {
      key: "integrations",
      label: "Integrations",
      icon: "integrations",
      scoped: true,
    },
    { key: "settings", label: "Settings", icon: "settings", section: "bottom" },
  ];

  /* ── Styles (namespaced, injected once) ──────────────────────────── */

  var STYLE_ID = "atlas-nav-styles";
  var CSS = [
    "[data-atlas-nav]{display:contents;}",
    '.anav{--anav-w:236px;width:var(--anav-w);flex-shrink:0;background:#fff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;position:relative;}',
    ".anav *{box-sizing:border-box;}",
    /* logo */
    ".anav-logo{padding:16px 16px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f1f5f9;}",
    ".anav-logo-mark{width:28px;height:28px;background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;}",
    ".anav-logo-name{font-weight:700;font-size:15px;color:#0f172a;}",
    /* scroll body */
    ".anav-body{flex:1;overflow-y:auto;padding:10px 10px 6px;display:flex;flex-direction:column;}",
    ".anav-spacer{flex:1;}",
    /* generic item */
    ".anav-item{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:7px;border:none;background:none;text-align:left;text-decoration:none;cursor:pointer;color:#475569;font-size:13px;font-weight:500;font-family:inherit;}",
    ".anav-item:hover{background:#f1f5f9;color:#0f172a;}",
    ".anav-item.active{background:#eef2ff;color:#4f46e5;font-weight:600;}",
    ".anav-ico{width:16px;height:16px;flex-shrink:0;opacity:.65;}",
    ".anav-item.active .anav-ico{opacity:1;}",
    ".anav-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".anav-caret{width:14px;height:14px;flex-shrink:0;color:#94a3b8;transition:transform .15s;}",
    ".anav-group.open > .anav-item .anav-caret{transform:rotate(180deg);}",
    /* client switcher */
    ".anav-top{padding:10px 10px 4px;border-bottom:1px solid #f1f5f9;}",
    ".anav-client-wrap{position:relative;padding:10px 10px 6px;border-bottom:1px solid #f1f5f9;}",
    ".anav-scope-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;padding:2px 6px 6px;}",
    ".anav-client{display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;cursor:pointer;font-family:inherit;text-align:left;}",
    ".anav-client:hover{border-color:#cbd5e1;background:#f8fafc;}",
    ".anav-client.open{border-color:#c7d2fe;background:#eef2ff;}",
    ".anav-ava{width:26px;height:26px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;}",
    ".anav-ava.indigo{background:linear-gradient(135deg,#818cf8,#4f46e5);}",
    ".anav-ava.blue{background:linear-gradient(135deg,#60a5fa,#2563eb);}",
    ".anav-ava.violet{background:linear-gradient(135deg,#a78bfa,#7c3aed);}",
    ".anav-ava.amber{background:linear-gradient(135deg,#fbbf24,#d97706);}",
    ".anav-ava.green{background:linear-gradient(135deg,#4ade80,#16a34a);}",
    ".anav-client-tx{flex:1;min-width:0;}",
    ".anav-client-eyebrow{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;}",
    ".anav-client-name{font-size:12.5px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".anav-client-caret{width:14px;height:14px;color:#94a3b8;flex-shrink:0;transition:transform .15s;}",
    ".anav-client.open .anav-client-caret{transform:rotate(180deg);}",
    /* dropdown */
    ".anav-dd{position:absolute;left:10px;right:10px;top:calc(100% - 2px);z-index:30;background:#fff;border:1px solid #e2e8f0;border-radius:11px;box-shadow:0 12px 32px rgba(15,23,42,.16);padding:8px;display:none;max-height:60vh;overflow:hidden;flex-direction:column;}",
    ".anav-dd.open{display:flex;}",
    ".anav-dd-search{display:flex;align-items:center;gap:7px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;margin-bottom:6px;}",
    ".anav-dd-search svg{width:13px;height:13px;color:#94a3b8;flex-shrink:0;}",
    ".anav-dd-search input{border:none;background:none;outline:none;font-size:12px;color:#334155;width:100%;font-family:inherit;}",
    ".anav-dd-list{overflow-y:auto;}",
    ".anav-dd-item{display:flex;align-items:center;gap:9px;width:100%;padding:7px 8px;border-radius:8px;border:none;background:none;cursor:pointer;text-align:left;font-family:inherit;}",
    ".anav-dd-item:hover{background:#f1f5f9;}",
    ".anav-dd-item.sel{background:#eef2ff;}",
    ".anav-dd-name{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".anav-dd-check{width:15px;height:15px;color:#4f46e5;flex-shrink:0;opacity:0;}",
    ".anav-dd-item.sel .anav-dd-check{opacity:1;}",
    ".anav-dd-empty{padding:14px 8px;text-align:center;font-size:12px;color:#94a3b8;}",
    /* scoped section wrapper */
    ".anav-scope{position:relative;margin:2px 0;padding-left:0;}",
    ".anav-scope-rail{padding:6px 6px 6px;}",
    /* submenu */
    ".anav-sub{overflow:hidden;max-height:0;transition:max-height .18s ease;}",
    ".anav-group.open .anav-sub{max-height:240px;}",
    ".anav-subitem{display:flex;align-items:center;width:100%;padding:6px 10px 6px 38px;border-radius:7px;border:none;background:none;text-align:left;text-decoration:none;cursor:pointer;color:#64748b;font-size:12px;font-weight:500;font-family:inherit;position:relative;}",
    ".anav-subitem:hover{background:#f8fafc;color:#334155;}",
    ".anav-subitem.active{color:#4f46e5;font-weight:600;}",
    '.anav-subitem::before{content:"";position:absolute;left:21px;top:50%;width:5px;height:5px;border-radius:50%;background:#cbd5e1;transform:translateY(-50%);}',
    ".anav-subitem.active::before{background:#6366f1;}",
    /* divider before client-scoped block */
    ".anav-divider{height:1px;background:#f1f5f9;margin:8px 4px;}",
    /* footer */
    ".anav-footer{border-top:1px solid #f1f5f9;padding:8px 10px 10px;}",
    ".anav-user{display:flex;align-items:center;gap:10px;padding:6px 6px 10px;}",
    ".anav-user-ava{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#818cf8,#4f46e5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0;}",
    ".anav-user-name{font-size:12px;font-weight:600;color:#1e293b;}",
    ".anav-user-role{font-size:10px;color:#94a3b8;}",
    ".anav-logout{color:#64748b;}",
    ".anav-logout:hover{background:#fef2f2;color:#dc2626;}",
    ".anav-logout:hover .anav-ico{opacity:1;}",
  ].join("");

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /* ── Small helpers ───────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  function svg(pathKey, cls) {
    // Multi-path icons separate their paths with a literal '|||' marker.
    var body = (ICON[pathKey] || "")
      .split("|||")
      .map(function (p) {
        return (
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' +
          p +
          '"/>'
        );
      })
      .join("");
    return (
      '<svg class="' +
      cls +
      '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
      body +
      "</svg>"
    );
  }

  function findClient(clients, id) {
    for (var i = 0; i < clients.length; i++)
      if (clients[i].id === id) return clients[i];
    return clients[0];
  }

  function resolveHref(cfg, key) {
    var map = cfg.hrefs || {};
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    if (Object.prototype.hasOwnProperty.call(DEFAULT_HREFS, key))
      return DEFAULT_HREFS[key];
    return "#";
  }

  function isActive(active, key) {
    return active === key;
  }

  function parentOf(key) {
    var ix = key.indexOf("/");
    return ix === -1 ? null : key.slice(0, ix);
  }

  /* ── Markup builders ─────────────────────────────────────────────── */

  function buildItem(cfg, node) {
    var href = resolveHref(cfg, node.key);
    var active = isActive(cfg.active, node.key) ? " active" : "";
    return (
      '<a class="anav-item' +
      active +
      '" href="' +
      esc(href) +
      '" data-key="' +
      esc(node.key) +
      '">' +
      svg(node.icon, "anav-ico") +
      '<span class="anav-label">' +
      esc(node.label) +
      "</span>" +
      "</a>"
    );
  }

  function buildGroup(cfg, node) {
    var activeChild = node.children.some(function (c) {
      return isActive(cfg.active, c.key);
    });
    var open = activeChild || cfg.active === node.key;
    var subs = node.children
      .map(function (c) {
        var href = resolveHref(cfg, c.key);
        var act = isActive(cfg.active, c.key) ? " active" : "";
        return (
          '<a class="anav-subitem' +
          act +
          '" href="' +
          esc(href) +
          '" data-key="' +
          esc(c.key) +
          '">' +
          '<span class="anav-label">' +
          esc(c.label) +
          "</span></a>"
        );
      })
      .join("");
    return (
      '<div class="anav-group' +
      (open ? " open" : "") +
      '" data-group="' +
      esc(node.key) +
      '">' +
      '<button class="anav-item" type="button" data-toggle="' +
      esc(node.key) +
      '">' +
      svg(node.icon, "anav-ico") +
      '<span class="anav-label">' +
      esc(node.label) +
      "</span>" +
      svg("chevron", "anav-caret") +
      "</button>" +
      '<div class="anav-sub">' +
      subs +
      "</div>" +
      "</div>"
    );
  }

  function buildClientSwitcher(cfg) {
    var c = cfg.currentClient;
    return (
      '<div class="anav-client-wrap">' +
      '<div class="anav-scope-label">Client</div>' +
      '<button class="anav-client" type="button" data-client-toggle>' +
      '<span class="anav-ava ' +
      esc(c.tone || "indigo") +
      '">' +
      esc(c.initials) +
      "</span>" +
      '<span class="anav-client-tx">' +
      '<span class="anav-client-eyebrow">Active client</span>' +
      '<div class="anav-client-name">' +
      esc(c.name) +
      "</div>" +
      "</span>" +
      svg("chevron", "anav-client-caret") +
      "</button>" +
      buildDropdown(cfg) +
      "</div>"
    );
  }

  function buildDropdown(cfg) {
    var items = cfg.clients
      .map(function (c) {
        var sel = c.id === cfg.currentClient.id ? " sel" : "";
        return (
          '<button class="anav-dd-item' +
          sel +
          '" type="button" data-client-id="' +
          esc(c.id) +
          '" data-name="' +
          esc(c.name.toLowerCase()) +
          '">' +
          '<span class="anav-ava ' +
          esc(c.tone || "indigo") +
          '">' +
          esc(c.initials) +
          "</span>" +
          '<span class="anav-dd-name">' +
          esc(c.name) +
          "</span>" +
          svg("check", "anav-dd-check") +
          "</button>"
        );
      })
      .join("");
    return (
      '<div class="anav-dd" data-dd>' +
      '<div class="anav-dd-search">' +
      svg("search", "") +
      '<input type="text" placeholder="Search clients…" data-dd-search /></div>' +
      '<div class="anav-dd-list" data-dd-list>' +
      items +
      '<div class="anav-dd-empty" data-dd-empty style="display:none">No clients match</div>' +
      "</div>" +
      "</div>"
    );
  }

  function buildFooter(cfg) {
    var u = cfg.user;
    var logoutHref = cfg.hrefs && cfg.hrefs.logout ? cfg.hrefs.logout : "#";
    return (
      '<div class="anav-footer">' +
      '<div class="anav-user">' +
      '<div class="anav-user-ava">' +
      esc(u.initials) +
      "</div>" +
      '<div><div class="anav-user-name">' +
      esc(u.name) +
      "</div>" +
      '<div class="anav-user-role">' +
      esc(u.role) +
      "</div></div>" +
      "</div>" +
      '<a class="anav-item anav-logout" href="' +
      esc(logoutHref) +
      '" data-key="logout">' +
      svg("logout", "anav-ico") +
      '<span class="anav-label">Logout</span>' +
      "</a>" +
      "</div>"
    );
  }

  function render(cfg) {
    var topHtml = "";
    var scopedHtml = "";
    var bottomHtml = "";

    MENU.forEach(function (node) {
      var html = node.children ? buildGroup(cfg, node) : buildItem(cfg, node);
      if (node.section === "bottom") bottomHtml += html;
      else if (node.scoped) scopedHtml += html;
      else topHtml += html;
    });

    return (
      '<aside class="anav">' +
      '<div class="anav-logo">' +
      '<div class="anav-logo-mark">A</div>' +
      '<span class="anav-logo-name">Atlas</span>' +
      "</div>" +
      '<div class="anav-top">' +
      topHtml +
      "</div>" +
      buildClientSwitcher(cfg) +
      '<div class="anav-body">' +
      scopedHtml +
      '<div class="anav-spacer"></div>' +
      bottomHtml +
      "</div>" +
      buildFooter(cfg) +
      "</aside>"
    );
  }

  /* ── Behaviour ───────────────────────────────────────────────────── */

  function wire(mount, cfg) {
    var aside = mount.querySelector(".anav");
    var clientBtn = mount.querySelector("[data-client-toggle]");
    var dd = mount.querySelector("[data-dd]");
    var ddSearch = mount.querySelector("[data-dd-search]");
    var ddList = mount.querySelector("[data-dd-list]");
    var ddEmpty = mount.querySelector("[data-dd-empty]");

    function closeDd() {
      dd.classList.remove("open");
      clientBtn.classList.remove("open");
    }
    function openDd() {
      dd.classList.add("open");
      clientBtn.classList.add("open");
      if (ddSearch) {
        ddSearch.value = "";
        filterDd("");
        ddSearch.focus();
      }
    }
    function filterDd(q) {
      q = (q || "").trim().toLowerCase();
      var shown = 0;
      ddList.querySelectorAll("[data-client-id]").forEach(function (el) {
        var match = !q || el.getAttribute("data-name").indexOf(q) !== -1;
        el.style.display = match ? "" : "none";
        if (match) shown++;
      });
      if (ddEmpty) ddEmpty.style.display = shown ? "none" : "";
    }

    // Client switcher toggle
    clientBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dd.classList.contains("open")) closeDd();
      else openDd();
    });
    if (ddSearch)
      ddSearch.addEventListener("input", function () {
        filterDd(ddSearch.value);
      });

    // Client selection
    ddList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-client-id]");
      if (!btn) return;
      var id = btn.getAttribute("data-client-id");
      selectClient(id);
      closeDd();
    });

    function selectClient(id) {
      var next = findClient(cfg.clients, id);
      cfg.currentClient = next;
      // update label
      var ava = clientBtn.querySelector(".anav-ava");
      var name = clientBtn.querySelector(".anav-client-name");
      ava.className = "anav-ava " + (next.tone || "indigo");
      ava.textContent = next.initials;
      name.textContent = next.name;
      // update selected marker in list
      ddList.querySelectorAll("[data-client-id]").forEach(function (el) {
        el.classList.toggle("sel", el.getAttribute("data-client-id") === id);
      });
      mount.dispatchEvent(
        new CustomEvent("atlas-nav:clientchange", {
          bubbles: true,
          detail: { id: next.id, client: next },
        }),
      );
    }

    // Expand / collapse groups
    aside.querySelectorAll("[data-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.closest(".anav-group");
        group.classList.toggle("open");
      });
    });

    // Navigate events (let real links proceed; emit for hash/# links)
    aside.querySelectorAll("[data-key]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        var key = el.getAttribute("data-key");
        var href = el.getAttribute("href");
        mount.dispatchEvent(
          new CustomEvent("atlas-nav:navigate", {
            bubbles: true,
            detail: { key: key, href: href, label: el.textContent.trim() },
          }),
        );
        if (href === "#" || !href) e.preventDefault();
      });
    });

    // Close dropdown on outside click / Esc
    document.addEventListener("click", function (e) {
      if (!dd.contains(e.target) && !clientBtn.contains(e.target)) closeDd();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDd();
    });
  }

  /* ── Public API ──────────────────────────────────────────────────── */

  function normalizeConfig(raw) {
    var cfg = {
      active: raw.active || "home",
      clients:
        Array.isArray(raw.clients) && raw.clients.length
          ? raw.clients
          : DEFAULT_CLIENTS,
      user: Object.assign({}, DEFAULT_USER, raw.user || {}),
      hrefs: raw.hrefs || {},
    };
    cfg.currentClient = findClient(
      cfg.clients,
      raw.client || cfg.clients[0].id,
    );
    return cfg;
  }

  function init(mount, config) {
    if (typeof mount === "string") mount = document.querySelector(mount);
    if (!mount) return null;
    injectStyles();
    var cfg = normalizeConfig(config || {});
    mount.innerHTML = render(cfg);
    wire(mount, cfg);
    mount._atlasNavConfig = cfg;
    return cfg;
  }

  function autoInit() {
    var nodes = document.querySelectorAll("[data-atlas-nav]");
    nodes.forEach(function (node) {
      // Optional inline user override via data-user-* attributes.
      var user = {};
      if (node.getAttribute("data-user-name"))
        user.name = node.getAttribute("data-user-name");
      if (node.getAttribute("data-user-role"))
        user.role = node.getAttribute("data-user-role");
      if (node.getAttribute("data-user-initials"))
        user.initials = node.getAttribute("data-user-initials");
      init(node, {
        active: node.getAttribute("data-active") || "home",
        client: node.getAttribute("data-client") || undefined,
        user: Object.keys(user).length ? user : undefined,
      });
    });
  }

  global.AtlasNav = {
    init: init,
    MENU: MENU,
    DEFAULT_CLIENTS: DEFAULT_CLIENTS,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})(window);
