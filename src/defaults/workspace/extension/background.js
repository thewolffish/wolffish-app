var browserPolyfill$1 = { exports: {} }, browserPolyfill = browserPolyfill$1.exports, hasRequiredBrowserPolyfill;
function requireBrowserPolyfill() {
  return hasRequiredBrowserPolyfill || (hasRequiredBrowserPolyfill = 1, (function(e, t) {
    (function(s, n) {
      n(e);
    })(typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : browserPolyfill, function(s) {
      if (!(globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id))
        throw new Error("This script should only be loaded in a browser extension.");
      if (globalThis.browser && globalThis.browser.runtime && globalThis.browser.runtime.id)
        s.exports = globalThis.browser;
      else {
        const n = "The message port closed before a response was received.", a = (o) => {
          const i = {
            alarms: {
              clear: {
                minArgs: 0,
                maxArgs: 1
              },
              clearAll: {
                minArgs: 0,
                maxArgs: 0
              },
              get: {
                minArgs: 0,
                maxArgs: 1
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            bookmarks: {
              create: {
                minArgs: 1,
                maxArgs: 1
              },
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getChildren: {
                minArgs: 1,
                maxArgs: 1
              },
              getRecent: {
                minArgs: 1,
                maxArgs: 1
              },
              getSubTree: {
                minArgs: 1,
                maxArgs: 1
              },
              getTree: {
                minArgs: 0,
                maxArgs: 0
              },
              move: {
                minArgs: 2,
                maxArgs: 2
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              removeTree: {
                minArgs: 1,
                maxArgs: 1
              },
              search: {
                minArgs: 1,
                maxArgs: 1
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            },
            browserAction: {
              disable: {
                minArgs: 0,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              enable: {
                minArgs: 0,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              getBadgeBackgroundColor: {
                minArgs: 1,
                maxArgs: 1
              },
              getBadgeText: {
                minArgs: 1,
                maxArgs: 1
              },
              getPopup: {
                minArgs: 1,
                maxArgs: 1
              },
              getTitle: {
                minArgs: 1,
                maxArgs: 1
              },
              openPopup: {
                minArgs: 0,
                maxArgs: 0
              },
              setBadgeBackgroundColor: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setBadgeText: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setIcon: {
                minArgs: 1,
                maxArgs: 1
              },
              setPopup: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setTitle: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              }
            },
            browsingData: {
              remove: {
                minArgs: 2,
                maxArgs: 2
              },
              removeCache: {
                minArgs: 1,
                maxArgs: 1
              },
              removeCookies: {
                minArgs: 1,
                maxArgs: 1
              },
              removeDownloads: {
                minArgs: 1,
                maxArgs: 1
              },
              removeFormData: {
                minArgs: 1,
                maxArgs: 1
              },
              removeHistory: {
                minArgs: 1,
                maxArgs: 1
              },
              removeLocalStorage: {
                minArgs: 1,
                maxArgs: 1
              },
              removePasswords: {
                minArgs: 1,
                maxArgs: 1
              },
              removePluginData: {
                minArgs: 1,
                maxArgs: 1
              },
              settings: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            commands: {
              getAll: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            contextMenus: {
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              removeAll: {
                minArgs: 0,
                maxArgs: 0
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            },
            cookies: {
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getAll: {
                minArgs: 1,
                maxArgs: 1
              },
              getAllCookieStores: {
                minArgs: 0,
                maxArgs: 0
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              set: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            devtools: {
              inspectedWindow: {
                eval: {
                  minArgs: 1,
                  maxArgs: 2,
                  singleCallbackArg: !1
                }
              },
              panels: {
                create: {
                  minArgs: 3,
                  maxArgs: 3,
                  singleCallbackArg: !0
                },
                elements: {
                  createSidebarPane: {
                    minArgs: 1,
                    maxArgs: 1
                  }
                }
              }
            },
            downloads: {
              cancel: {
                minArgs: 1,
                maxArgs: 1
              },
              download: {
                minArgs: 1,
                maxArgs: 1
              },
              erase: {
                minArgs: 1,
                maxArgs: 1
              },
              getFileIcon: {
                minArgs: 1,
                maxArgs: 2
              },
              open: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              pause: {
                minArgs: 1,
                maxArgs: 1
              },
              removeFile: {
                minArgs: 1,
                maxArgs: 1
              },
              resume: {
                minArgs: 1,
                maxArgs: 1
              },
              search: {
                minArgs: 1,
                maxArgs: 1
              },
              show: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              }
            },
            extension: {
              isAllowedFileSchemeAccess: {
                minArgs: 0,
                maxArgs: 0
              },
              isAllowedIncognitoAccess: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            history: {
              addUrl: {
                minArgs: 1,
                maxArgs: 1
              },
              deleteAll: {
                minArgs: 0,
                maxArgs: 0
              },
              deleteRange: {
                minArgs: 1,
                maxArgs: 1
              },
              deleteUrl: {
                minArgs: 1,
                maxArgs: 1
              },
              getVisits: {
                minArgs: 1,
                maxArgs: 1
              },
              search: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            i18n: {
              detectLanguage: {
                minArgs: 1,
                maxArgs: 1
              },
              getAcceptLanguages: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            identity: {
              launchWebAuthFlow: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            idle: {
              queryState: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            management: {
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              },
              getSelf: {
                minArgs: 0,
                maxArgs: 0
              },
              setEnabled: {
                minArgs: 2,
                maxArgs: 2
              },
              uninstallSelf: {
                minArgs: 0,
                maxArgs: 1
              }
            },
            notifications: {
              clear: {
                minArgs: 1,
                maxArgs: 1
              },
              create: {
                minArgs: 1,
                maxArgs: 2
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              },
              getPermissionLevel: {
                minArgs: 0,
                maxArgs: 0
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            },
            pageAction: {
              getPopup: {
                minArgs: 1,
                maxArgs: 1
              },
              getTitle: {
                minArgs: 1,
                maxArgs: 1
              },
              hide: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setIcon: {
                minArgs: 1,
                maxArgs: 1
              },
              setPopup: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setTitle: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              show: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              }
            },
            permissions: {
              contains: {
                minArgs: 1,
                maxArgs: 1
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              request: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            runtime: {
              getBackgroundPage: {
                minArgs: 0,
                maxArgs: 0
              },
              getPlatformInfo: {
                minArgs: 0,
                maxArgs: 0
              },
              openOptionsPage: {
                minArgs: 0,
                maxArgs: 0
              },
              requestUpdateCheck: {
                minArgs: 0,
                maxArgs: 0
              },
              sendMessage: {
                minArgs: 1,
                maxArgs: 3
              },
              sendNativeMessage: {
                minArgs: 2,
                maxArgs: 2
              },
              setUninstallURL: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            sessions: {
              getDevices: {
                minArgs: 0,
                maxArgs: 1
              },
              getRecentlyClosed: {
                minArgs: 0,
                maxArgs: 1
              },
              restore: {
                minArgs: 0,
                maxArgs: 1
              }
            },
            storage: {
              local: {
                clear: {
                  minArgs: 0,
                  maxArgs: 0
                },
                get: {
                  minArgs: 0,
                  maxArgs: 1
                },
                getBytesInUse: {
                  minArgs: 0,
                  maxArgs: 1
                },
                remove: {
                  minArgs: 1,
                  maxArgs: 1
                },
                set: {
                  minArgs: 1,
                  maxArgs: 1
                }
              },
              managed: {
                get: {
                  minArgs: 0,
                  maxArgs: 1
                },
                getBytesInUse: {
                  minArgs: 0,
                  maxArgs: 1
                }
              },
              sync: {
                clear: {
                  minArgs: 0,
                  maxArgs: 0
                },
                get: {
                  minArgs: 0,
                  maxArgs: 1
                },
                getBytesInUse: {
                  minArgs: 0,
                  maxArgs: 1
                },
                remove: {
                  minArgs: 1,
                  maxArgs: 1
                },
                set: {
                  minArgs: 1,
                  maxArgs: 1
                }
              }
            },
            tabs: {
              captureVisibleTab: {
                minArgs: 0,
                maxArgs: 2
              },
              create: {
                minArgs: 1,
                maxArgs: 1
              },
              detectLanguage: {
                minArgs: 0,
                maxArgs: 1
              },
              discard: {
                minArgs: 0,
                maxArgs: 1
              },
              duplicate: {
                minArgs: 1,
                maxArgs: 1
              },
              executeScript: {
                minArgs: 1,
                maxArgs: 2
              },
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getCurrent: {
                minArgs: 0,
                maxArgs: 0
              },
              getZoom: {
                minArgs: 0,
                maxArgs: 1
              },
              getZoomSettings: {
                minArgs: 0,
                maxArgs: 1
              },
              goBack: {
                minArgs: 0,
                maxArgs: 1
              },
              goForward: {
                minArgs: 0,
                maxArgs: 1
              },
              highlight: {
                minArgs: 1,
                maxArgs: 1
              },
              insertCSS: {
                minArgs: 1,
                maxArgs: 2
              },
              move: {
                minArgs: 2,
                maxArgs: 2
              },
              query: {
                minArgs: 1,
                maxArgs: 1
              },
              reload: {
                minArgs: 0,
                maxArgs: 2
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              removeCSS: {
                minArgs: 1,
                maxArgs: 2
              },
              sendMessage: {
                minArgs: 2,
                maxArgs: 3
              },
              setZoom: {
                minArgs: 1,
                maxArgs: 2
              },
              setZoomSettings: {
                minArgs: 1,
                maxArgs: 2
              },
              update: {
                minArgs: 1,
                maxArgs: 2
              }
            },
            topSites: {
              get: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            webNavigation: {
              getAllFrames: {
                minArgs: 1,
                maxArgs: 1
              },
              getFrame: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            webRequest: {
              handlerBehaviorChanged: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            windows: {
              create: {
                minArgs: 0,
                maxArgs: 1
              },
              get: {
                minArgs: 1,
                maxArgs: 2
              },
              getAll: {
                minArgs: 0,
                maxArgs: 1
              },
              getCurrent: {
                minArgs: 0,
                maxArgs: 1
              },
              getLastFocused: {
                minArgs: 0,
                maxArgs: 1
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            }
          };
          if (Object.keys(i).length === 0)
            throw new Error("api-metadata.json has not been included in browser-polyfill");
          class r extends WeakMap {
            constructor(g, f = void 0) {
              super(f), this.createItem = g;
            }
            get(g) {
              return this.has(g) || this.set(g, this.createItem(g)), super.get(g);
            }
          }
          const l = (d) => d && typeof d == "object" && typeof d.then == "function", c = (d, g) => (...f) => {
            o.runtime.lastError ? d.reject(new Error(o.runtime.lastError.message)) : g.singleCallbackArg || f.length <= 1 && g.singleCallbackArg !== !1 ? d.resolve(f[0]) : d.resolve(f);
          }, m = (d) => d == 1 ? "argument" : "arguments", u = (d, g) => function(p, ...R) {
            if (R.length < g.minArgs)
              throw new Error(`Expected at least ${g.minArgs} ${m(g.minArgs)} for ${d}(), got ${R.length}`);
            if (R.length > g.maxArgs)
              throw new Error(`Expected at most ${g.maxArgs} ${m(g.maxArgs)} for ${d}(), got ${R.length}`);
            return new Promise((C, b) => {
              if (g.fallbackToNoCallback)
                try {
                  p[d](...R, c({
                    resolve: C,
                    reject: b
                  }, g));
                } catch (h) {
                  console.warn(`${d} API method doesn't seem to support the callback parameter, falling back to call it without a callback: `, h), p[d](...R), g.fallbackToNoCallback = !1, g.noCallback = !0, C();
                }
              else g.noCallback ? (p[d](...R), C()) : p[d](...R, c({
                resolve: C,
                reject: b
              }, g));
            });
          }, A = (d, g, f) => new Proxy(g, {
            apply(p, R, C) {
              return f.call(R, d, ...C);
            }
          });
          let _ = Function.call.bind(Object.prototype.hasOwnProperty);
          const S = (d, g = {}, f = {}) => {
            let p = /* @__PURE__ */ Object.create(null), R = {
              has(b, h) {
                return h in d || h in p;
              },
              get(b, h, y) {
                if (h in p)
                  return p[h];
                if (!(h in d))
                  return;
                let E = d[h];
                if (typeof E == "function")
                  if (typeof g[h] == "function")
                    E = A(d, d[h], g[h]);
                  else if (_(f, h)) {
                    let O = u(h, f[h]);
                    E = A(d, d[h], O);
                  } else
                    E = E.bind(d);
                else if (typeof E == "object" && E !== null && (_(g, h) || _(f, h)))
                  E = S(E, g[h], f[h]);
                else if (_(f, "*"))
                  E = S(E, g[h], f["*"]);
                else
                  return Object.defineProperty(p, h, {
                    configurable: !0,
                    enumerable: !0,
                    get() {
                      return d[h];
                    },
                    set(O) {
                      d[h] = O;
                    }
                  }), E;
                return p[h] = E, E;
              },
              set(b, h, y, E) {
                return h in p ? p[h] = y : d[h] = y, !0;
              },
              defineProperty(b, h, y) {
                return Reflect.defineProperty(p, h, y);
              },
              deleteProperty(b, h) {
                return Reflect.deleteProperty(p, h);
              }
            }, C = Object.create(d);
            return new Proxy(C, R);
          }, W = (d) => ({
            addListener(g, f, ...p) {
              g.addListener(d.get(f), ...p);
            },
            hasListener(g, f) {
              return g.hasListener(d.get(f));
            },
            removeListener(g, f) {
              g.removeListener(d.get(f));
            }
          }), x = new r((d) => typeof d != "function" ? d : function(f) {
            const p = S(f, {}, {
              getContent: {
                minArgs: 0,
                maxArgs: 0
              }
            });
            d(p);
          }), w = new r((d) => typeof d != "function" ? d : function(f, p, R) {
            let C = !1, b, h = new Promise((I) => {
              b = function(v) {
                C = !0, I(v);
              };
            }), y;
            try {
              y = d(f, p, b);
            } catch (I) {
              y = Promise.reject(I);
            }
            const E = y !== !0 && l(y);
            if (y !== !0 && !E && !C)
              return !1;
            const O = (I) => {
              I.then((v) => {
                R(v);
              }, (v) => {
                let D;
                v && (v instanceof Error || typeof v.message == "string") ? D = v.message : D = "An unexpected error occurred", R({
                  __mozWebExtensionPolyfillReject__: !0,
                  message: D
                });
              }).catch((v) => {
                console.error("Failed to send onMessage rejected reply", v);
              });
            };
            return O(E ? y : h), !0;
          }), T = ({
            reject: d,
            resolve: g
          }, f) => {
            o.runtime.lastError ? o.runtime.lastError.message === n ? g() : d(new Error(o.runtime.lastError.message)) : f && f.__mozWebExtensionPolyfillReject__ ? d(new Error(f.message)) : g(f);
          }, M = (d, g, f, ...p) => {
            if (p.length < g.minArgs)
              throw new Error(`Expected at least ${g.minArgs} ${m(g.minArgs)} for ${d}(), got ${p.length}`);
            if (p.length > g.maxArgs)
              throw new Error(`Expected at most ${g.maxArgs} ${m(g.maxArgs)} for ${d}(), got ${p.length}`);
            return new Promise((R, C) => {
              const b = T.bind(null, {
                resolve: R,
                reject: C
              });
              p.push(b), f.sendMessage(...p);
            });
          }, P = {
            devtools: {
              network: {
                onRequestFinished: W(x)
              }
            },
            runtime: {
              onMessage: W(w),
              onMessageExternal: W(w),
              sendMessage: M.bind(null, "sendMessage", {
                minArgs: 1,
                maxArgs: 3
              })
            },
            tabs: {
              sendMessage: M.bind(null, "sendMessage", {
                minArgs: 2,
                maxArgs: 3
              })
            }
          }, B = {
            clear: {
              minArgs: 1,
              maxArgs: 1
            },
            get: {
              minArgs: 1,
              maxArgs: 1
            },
            set: {
              minArgs: 1,
              maxArgs: 1
            }
          };
          return i.privacy = {
            network: {
              "*": B
            },
            services: {
              "*": B
            },
            websites: {
              "*": B
            }
          }, S(o, P, i);
        };
        s.exports = a(chrome);
      }
    });
  })(browserPolyfill$1)), browserPolyfill$1.exports;
}
requireBrowserPolyfill();
const DEFAULT_PORT = 23151, LOG_PREFIX = "[Wolffish]", HEARTBEAT_INTERVAL_MS = 15e3, COMMAND_TIMEOUT_MS = 3e4, CONTENT_SCRIPT_PING_TIMEOUT_MS = 500, WolffishCommands = {
  // Navigation
  BROWSER_NAVIGATE: "browser_navigate",
  BROWSER_BACK: "browser_back",
  BROWSER_FORWARD: "browser_forward",
  BROWSER_RELOAD: "browser_reload",
  // Page Interaction
  BROWSER_CLICK: "browser_click",
  BROWSER_TYPE: "browser_type",
  BROWSER_SELECT: "browser_select",
  BROWSER_HOVER: "browser_hover",
  BROWSER_SCROLL: "browser_scroll",
  BROWSER_FOCUS: "browser_focus",
  BROWSER_KEYPRESS: "browser_keypress",
  BROWSER_DRAG_DROP: "browser_drag_drop",
  BROWSER_FILE_UPLOAD: "browser_file_upload",
  // Page Reading
  BROWSER_READ_PAGE: "browser_read_page",
  BROWSER_QUERY_SELECTOR: "browser_query_selector",
  BROWSER_GET_ATTRIBUTE: "browser_get_attribute",
  BROWSER_GET_VALUE: "browser_get_value",
  BROWSER_GET_URL: "browser_get_url",
  BROWSER_GET_PAGE_INFO: "browser_get_page_info",
  // Tab Management
  BROWSER_TABS_LIST: "browser_tabs_list",
  BROWSER_TAB_OPEN: "browser_tab_open",
  BROWSER_TAB_CLOSE: "browser_tab_close",
  BROWSER_TAB_SWITCH: "browser_tab_switch",
  BROWSER_TAB_DUPLICATE: "browser_tab_duplicate",
  BROWSER_TAB_MOVE: "browser_tab_move",
  // Window Management
  BROWSER_WINDOWS_LIST: "browser_windows_list",
  BROWSER_WINDOW_OPEN: "browser_window_open",
  BROWSER_WINDOW_CLOSE: "browser_window_close",
  BROWSER_WINDOW_RESIZE: "browser_window_resize",
  // Screenshots & Visual
  BROWSER_SCREENSHOT: "browser_screenshot",
  BROWSER_PDF: "browser_pdf",
  // Cookies & Storage
  BROWSER_COOKIES_GET: "browser_cookies_get",
  BROWSER_COOKIES_SET: "browser_cookies_set",
  BROWSER_COOKIES_REMOVE: "browser_cookies_remove",
  BROWSER_STORAGE_GET: "browser_storage_get",
  BROWSER_STORAGE_SET: "browser_storage_set",
  // Clipboard
  BROWSER_CLIPBOARD_READ: "browser_clipboard_read",
  BROWSER_CLIPBOARD_WRITE: "browser_clipboard_write",
  // Downloads
  BROWSER_DOWNLOAD: "browser_download",
  // JavaScript Execution
  BROWSER_EXECUTE_JS: "browser_execute_js",
  // Wait & Polling
  // browser_wait is the generic entry models reach for first (it mirrors
  // the playwright capability's browser_wait): a plain sleep, or a
  // selector/navigation/network-idle wait dispatched on `type`. The
  // specific BROWSER_WAIT_FOR_* commands below remain the primary tools.
  BROWSER_WAIT: "browser_wait",
  BROWSER_WAIT_FOR: "browser_wait_for",
  BROWSER_WAIT_FOR_NAVIGATION: "browser_wait_for_navigation",
  BROWSER_WAIT_FOR_NETWORK_IDLE: "browser_wait_for_network_idle",
  // Notifications
  BROWSER_NOTIFY: "browser_notify",
  // Debugger Mode
  DEBUGGER_ATTACH: "browser_debugger_attach",
  DEBUGGER_DETACH: "browser_debugger_detach",
  DEBUGGER_STATUS: "browser_debugger_status",
  // Mouse Move
  BROWSER_MOUSE_MOVE: "browser_mouse_move",
  // Humanize
  HUMANIZE: "browser_humanize"
}, CONTENT_SCRIPT_COMMANDS = /* @__PURE__ */ new Set([
  WolffishCommands.BROWSER_CLICK,
  WolffishCommands.BROWSER_TYPE,
  WolffishCommands.BROWSER_SELECT,
  WolffishCommands.BROWSER_HOVER,
  WolffishCommands.BROWSER_SCROLL,
  WolffishCommands.BROWSER_FOCUS,
  WolffishCommands.BROWSER_KEYPRESS,
  WolffishCommands.BROWSER_DRAG_DROP,
  WolffishCommands.BROWSER_FILE_UPLOAD,
  WolffishCommands.BROWSER_READ_PAGE,
  WolffishCommands.BROWSER_QUERY_SELECTOR,
  WolffishCommands.BROWSER_GET_ATTRIBUTE,
  WolffishCommands.BROWSER_GET_VALUE,
  WolffishCommands.BROWSER_GET_PAGE_INFO,
  WolffishCommands.BROWSER_STORAGE_GET,
  WolffishCommands.BROWSER_STORAGE_SET,
  WolffishCommands.BROWSER_CLIPBOARD_READ,
  WolffishCommands.BROWSER_CLIPBOARD_WRITE,
  WolffishCommands.BROWSER_WAIT_FOR,
  WolffishCommands.BROWSER_WAIT_FOR_NETWORK_IDLE
]), SERVICE_WORKER_COMMANDS = /* @__PURE__ */ new Set([
  WolffishCommands.BROWSER_NAVIGATE,
  WolffishCommands.BROWSER_BACK,
  WolffishCommands.BROWSER_FORWARD,
  WolffishCommands.BROWSER_RELOAD,
  WolffishCommands.BROWSER_TABS_LIST,
  WolffishCommands.BROWSER_TAB_OPEN,
  WolffishCommands.BROWSER_TAB_CLOSE,
  WolffishCommands.BROWSER_TAB_SWITCH,
  WolffishCommands.BROWSER_TAB_DUPLICATE,
  WolffishCommands.BROWSER_TAB_MOVE,
  WolffishCommands.BROWSER_WINDOWS_LIST,
  WolffishCommands.BROWSER_WINDOW_OPEN,
  WolffishCommands.BROWSER_WINDOW_CLOSE,
  WolffishCommands.BROWSER_WINDOW_RESIZE,
  WolffishCommands.BROWSER_SCREENSHOT,
  WolffishCommands.BROWSER_PDF,
  WolffishCommands.BROWSER_COOKIES_GET,
  WolffishCommands.BROWSER_COOKIES_SET,
  WolffishCommands.BROWSER_COOKIES_REMOVE,
  WolffishCommands.BROWSER_DOWNLOAD,
  WolffishCommands.BROWSER_EXECUTE_JS,
  // Service-worker side so a bare sleep works with no page attached; the
  // selector/network-idle variants delegate to the content script.
  WolffishCommands.BROWSER_WAIT,
  WolffishCommands.BROWSER_WAIT_FOR_NAVIGATION,
  WolffishCommands.BROWSER_NOTIFY,
  WolffishCommands.BROWSER_GET_URL,
  WolffishCommands.DEBUGGER_ATTACH,
  WolffishCommands.DEBUGGER_DETACH,
  WolffishCommands.DEBUGGER_STATUS,
  WolffishCommands.BROWSER_MOUSE_MOVE,
  WolffishCommands.HUMANIZE
]), DEBUGGER_ROUTABLE_COMMANDS = /* @__PURE__ */ new Set([
  WolffishCommands.BROWSER_CLICK,
  WolffishCommands.BROWSER_TYPE,
  WolffishCommands.BROWSER_SCROLL,
  WolffishCommands.BROWSER_HOVER,
  WolffishCommands.BROWSER_KEYPRESS
]), api$3 = globalThis.chrome ?? globalThis.browser, log = (...e) => {
  console.log(LOG_PREFIX, ...e);
}, logError = (...e) => {
  console.error(LOG_PREFIX, ...e);
}, isFirefox = () => typeof globalThis.browser < "u", sendToContentScript = async (e, t) => {
  var s;
  return (s = api$3 == null ? void 0 : api$3.tabs) == null ? void 0 : s.sendMessage(e, t);
}, pingContentScript = async (e) => {
  var t;
  try {
    const s = {
      source: "service-worker",
      target: "content-script",
      payload: { type: "ping" }
    }, n = await Promise.race([
      (t = api$3 == null ? void 0 : api$3.tabs) == null ? void 0 : t.sendMessage(e, s),
      new Promise((a, o) => setTimeout(() => o(new Error("timeout")), CONTENT_SCRIPT_PING_TIMEOUT_MS))
    ]);
    return n && n.type === "pong";
  } catch {
    return !1;
  }
}, ensureContentScriptInjected = async (e) => {
  var s;
  await pingContentScript(e) || (await ((s = api$3 == null ? void 0 : api$3.scripting) == null ? void 0 : s.executeScript({
    target: { tabId: e },
    files: ["content/all.iife.js"]
  })), await new Promise((n, a) => {
    var r, l;
    const o = setTimeout(() => a(new Error("Content script injection timed out")), 5e3), i = (c) => {
      var m, u;
      (c == null ? void 0 : c.source) === "content-script" && "type" in c.payload && c.payload.type === "pong" && (clearTimeout(o), (u = (m = api$3 == null ? void 0 : api$3.runtime) == null ? void 0 : m.onMessage) == null || u.removeListener(i), n());
    };
    (l = (r = api$3 == null ? void 0 : api$3.runtime) == null ? void 0 : r.onMessage) == null || l.addListener(i);
  }));
}, resolveTabId = async (e) => {
  var s;
  if (e.tabId !== void 0)
    return e.tabId;
  const t = await ((s = api$3 == null ? void 0 : api$3.tabs) == null ? void 0 : s.query({ active: !0, currentWindow: !0 }));
  if (!(t != null && t.length))
    throw new Error("No active tab found");
  return t[0].id;
}, withTimeout = (e) => e, makeResponse = (e, t) => ({ id: e, success: !0, data: t }), makeErrorResponse = (e, t) => ({ id: e, success: !1, error: t }), generateId = () => crypto.randomUUID();
var StorageEnum;
(function(e) {
  e.Local = "local", e.Sync = "sync", e.Managed = "managed", e.Session = "session";
})(StorageEnum || (StorageEnum = {}));
var SessionAccessLevelEnum;
(function(e) {
  e.ExtensionPagesOnly = "TRUSTED_CONTEXTS", e.ExtensionPagesAndContentScripts = "TRUSTED_AND_UNTRUSTED_CONTEXTS";
})(SessionAccessLevelEnum || (SessionAccessLevelEnum = {}));
const chrome$1 = globalThis.chrome, updateCache = async (e, t) => {
  const s = (a) => typeof a == "function", n = (a) => (
    // Use ReturnType to infer the return type of the function and check if it's a Promise
    a instanceof Promise
  );
  return s(e) ? (n(e), e(t)) : e;
};
let globalSessionAccessLevelFlag = !1;
const checkStoragePermission = (e) => {
  if (chrome$1 && !chrome$1.storage[e])
    throw new Error(`"storage" permission in manifest.ts: "storage ${e}" isn't defined`);
}, createStorage = (e, t, s) => {
  var W, x;
  let n = null, a = !1, o = [];
  const i = (s == null ? void 0 : s.storageEnum) ?? StorageEnum.Local, r = ((W = s == null ? void 0 : s.serialization) == null ? void 0 : W.serialize) ?? ((w) => w), l = ((x = s == null ? void 0 : s.serialization) == null ? void 0 : x.deserialize) ?? ((w) => w);
  globalSessionAccessLevelFlag === !1 && i === StorageEnum.Session && (s == null ? void 0 : s.sessionAccessForContentScripts) === !0 && (checkStoragePermission(i), chrome$1 == null || chrome$1.storage[i].setAccessLevel({
    accessLevel: SessionAccessLevelEnum.ExtensionPagesAndContentScripts
  }).catch((w) => {
    console.error(w), console.error("Please call .setAccessLevel() into different context, like a background script.");
  }), globalSessionAccessLevelFlag = !0);
  const c = async () => {
    checkStoragePermission(i);
    const w = await (chrome$1 == null ? void 0 : chrome$1.storage[i].get([e]));
    return w ? l(w[e]) ?? t : t;
  }, m = async (w) => {
    a || (n = await c()), n = await updateCache(w, n), await (chrome$1 == null ? void 0 : chrome$1.storage[i].set({ [e]: r(n) })), _();
  }, u = (w) => (o = [...o, w], () => {
    o = o.filter((T) => T !== w);
  }), A = () => n, _ = () => {
    o.forEach((w) => w());
  }, S = async (w) => {
    if (w[e] === void 0)
      return;
    const T = l(w[e].newValue);
    n !== T && (n = await updateCache(T, n), _());
  };
  return c().then((w) => {
    n = w, a = !0, _();
  }), chrome$1 == null || chrome$1.storage[i].onChanged.addListener(S), {
    get: c,
    set: m,
    getSnapshot: A,
    subscribe: u
  };
}, storage = createStorage("wolffish-connection-config", { port: 23151 }, {
  storageEnum: StorageEnum.Local
}), wolffishConnectionStorage = {
  ...storage
}, gaussianRandom = (e, t) => {
  let s = 0, n = 0;
  for (; s === 0; ) s = Math.random();
  for (; n === 0; ) n = Math.random();
  const a = Math.sqrt(-2 * Math.log(s)) * Math.cos(2 * Math.PI * n);
  return Math.round(e + a * t);
}, clamp = (e, t, s) => Math.max(t, Math.min(s, e)), gaussianDelay = (e, t, s) => {
  const n = s ?? (e + t) / 2, a = (t - e) / 4;
  return clamp(gaussianRandom(n, a), e, t);
}, sleep = (e) => new Promise((t) => setTimeout(t, e)), api$2 = globalThis.chrome;
let attachedTabId = null, isAttached = !1;
const resetState = () => {
  attachedTabId = null, isAttached = !1;
}, getDebuggerState = () => ({
  attached: isAttached,
  tabId: attachedTabId
}), sendCDP$1 = async (e, t = {}) => {
  if (!isAttached || attachedTabId === null)
    throw new Error("Debugger not attached");
  return api$2.debugger.sendCommand({ tabId: attachedTabId }, e, t);
}, generateBezierPath = (e, t, s, n, a) => {
  const o = e + (s - e) * 0.25 + (Math.random() - 0.5) * Math.abs(s - e) * 0.3, i = t + (n - t) * 0.25 + (Math.random() - 0.5) * Math.abs(n - t) * 0.3, r = e + (s - e) * 0.75 + (Math.random() - 0.5) * Math.abs(s - e) * 0.3, l = t + (n - t) * 0.75 + (Math.random() - 0.5) * Math.abs(n - t) * 0.3, c = [];
  for (let m = 1; m <= a; m++) {
    const u = m / a, A = 1 - u, _ = A * A * A * e + 3 * A * A * u * o + 3 * A * u * u * r + u * u * u * s, S = A * A * A * t + 3 * A * A * u * i + 3 * A * u * u * l + u * u * u * n;
    c.push({ x: Math.round(_), y: Math.round(S) });
  }
  return c;
};
let cursorX = 0, cursorY = 0;
const getCursorPosition = () => ({ x: cursorX, y: cursorY });
api$2.debugger.onDetach.addListener((e, t) => {
  e.tabId === attachedTabId && (log(`Debugger detached from tab ${e.tabId}: ${t}`), resetState());
});
api$2.tabs.onRemoved.addListener((e) => {
  e === attachedTabId && (log(`Attached tab ${e} was closed`), resetState());
});
const handleDebuggerAttach = async (e) => {
  const { tabId: t } = e;
  if (isAttached && attachedTabId === t)
    return { success: !0, tabId: t };
  if (isAttached && attachedTabId !== null) {
    try {
      await api$2.debugger.detach({ tabId: attachedTabId });
    } catch {
    }
    resetState();
  }
  try {
    return await api$2.debugger.attach({ tabId: t }, "1.3"), attachedTabId = t, isAttached = !0, log(`Debugger attached to tab ${t}`), { success: !0, tabId: t };
  } catch (s) {
    resetState();
    const n = s instanceof Error ? s.message : String(s);
    throw n.includes("Cannot access") || n.includes("chrome://") || n.includes("chrome-extension://") ? new Error("Cannot attach debugger to restricted page (chrome://, chrome-extension://, etc.)") : n.includes("Another debugger") ? new Error("Cannot attach debugger: DevTools or another debugger is already attached to this tab") : new Error(`Failed to attach debugger: ${n}`);
  }
}, handleDebuggerDetach = async () => {
  if (!isAttached || attachedTabId === null)
    return { success: !0 };
  try {
    await api$2.debugger.detach({ tabId: attachedTabId });
  } catch {
  }
  return log(`Debugger detached from tab ${attachedTabId}`), resetState(), { success: !0 };
}, handleDebuggerStatus = async () => ({
  attached: isAttached,
  tabId: attachedTabId
}), handleCDPClick = async (e) => {
  var r;
  const { selector: t } = e, s = attachedTabId, a = (r = (await api$2.scripting.executeScript({
    target: { tabId: s },
    func: (l) => {
      const c = document.querySelector(l);
      if (!c) return null;
      c.scrollIntoView({ behavior: "smooth", block: "center" });
      const m = c.getBoundingClientRect(), u = c.closest("a");
      return {
        x: Math.round(m.left + m.width / 2),
        y: Math.round(m.top + m.height / 2),
        href: (u == null ? void 0 : u.href) || null
      };
    },
    args: [t],
    world: "MAIN"
  }))[0]) == null ? void 0 : r.result;
  if (!a) throw new Error(`Element not found: ${t}`);
  await sleep(gaussianDelay(50, 150));
  const o = gaussianDelay(10, 20), i = generateBezierPath(cursorX, cursorY, a.x, a.y, o);
  for (const l of i)
    await sendCDP$1("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: l.x,
      y: l.y
    }), await sleep(gaussianDelay(5, 15));
  return cursorX = a.x, cursorY = a.y, await sendCDP$1("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: a.x,
    y: a.y,
    button: "left",
    clickCount: 1
  }), await sleep(gaussianDelay(30, 80)), await sendCDP$1("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: a.x,
    y: a.y,
    button: "left",
    clickCount: 1
  }), a.href && (await sleep(200), await api$2.scripting.executeScript({
    target: { tabId: s },
    func: (l) => {
      const c = document.querySelector(l), m = c == null ? void 0 : c.closest("a");
      m && m.click();
    },
    args: [t],
    world: "MAIN"
  })), { success: !0, elementFound: !0 };
}, handleCDPType = async (e) => {
  const { selector: t, text: s, clearFirst: n } = e, a = attachedTabId;
  await api$2.scripting.executeScript({
    target: { tabId: a },
    func: (o, i) => {
      const r = document.querySelector(o);
      if (!r) throw new Error(`Element not found: ${o}`);
      r.focus(), i && (r.tagName === "INPUT" || r.tagName === "TEXTAREA" ? (r.value = "", r.dispatchEvent(new Event("input", { bubbles: !0 }))) : r.isContentEditable && (document.execCommand("selectAll", !1), document.execCommand("delete", !1)));
    },
    args: [t, n ?? !1],
    world: "MAIN"
  });
  for (const o of s) {
    const i = o.charCodeAt(0), r = o, l = o.length === 1 && o >= "a" && o <= "z" ? `Key${o.toUpperCase()}` : o.length === 1 && o >= "A" && o <= "Z" ? `Key${o}` : o.length === 1 && o >= "0" && o <= "9" ? `Digit${o}` : o === " " ? "Space" : "";
    await sendCDP$1("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: r,
      code: l,
      windowsVirtualKeyCode: i,
      nativeVirtualKeyCode: i
    }), await sendCDP$1("Input.dispatchKeyEvent", {
      type: "char",
      text: o,
      key: r,
      code: l,
      windowsVirtualKeyCode: i,
      nativeVirtualKeyCode: i
    }), await sendCDP$1("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: r,
      code: l,
      windowsVirtualKeyCode: i,
      nativeVirtualKeyCode: i
    }), await sleep(gaussianDelay(40, 120, 70));
  }
  return { success: !0 };
}, handleCDPScroll = async (e) => {
  var l;
  const { direction: t, amount: s, selector: n } = e;
  if (n) {
    const c = attachedTabId, u = (l = (await api$2.scripting.executeScript({
      target: { tabId: c },
      func: (A) => {
        const _ = document.querySelector(A);
        if (!_) return null;
        const S = _.getBoundingClientRect();
        return { x: Math.round(S.left + S.width / 2), y: Math.round(S.top + S.height / 2) };
      },
      args: [n],
      world: "MAIN"
    }))[0]) == null ? void 0 : l.result;
    if (u)
      return await sendCDP$1("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: u.x,
        y: u.y,
        deltaX: 0,
        deltaY: 0
      }), { success: !0 };
  }
  const a = s ?? 300, o = {
    up: [0, -a],
    down: [0, a],
    left: [-a, 0],
    right: [a, 0]
  }, [i, r] = o[t] ?? [0, 0];
  return await sendCDP$1("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: cursorX || 400,
    y: cursorY || 400,
    deltaX: i,
    deltaY: r
  }), await sleep(gaussianDelay(50, 150)), { success: !0 };
}, handleCDPHover = async (e) => {
  var r;
  const { selector: t } = e, s = attachedTabId, a = (r = (await api$2.scripting.executeScript({
    target: { tabId: s },
    func: (l) => {
      const c = document.querySelector(l);
      if (!c) return null;
      c.scrollIntoView({ behavior: "smooth", block: "center" });
      const m = c.getBoundingClientRect();
      return { x: Math.round(m.left + m.width / 2), y: Math.round(m.top + m.height / 2) };
    },
    args: [t],
    world: "MAIN"
  }))[0]) == null ? void 0 : r.result;
  if (!a) throw new Error(`Element not found: ${t}`);
  await sleep(100);
  const o = gaussianDelay(10, 20), i = generateBezierPath(cursorX, cursorY, a.x, a.y, o);
  for (const l of i)
    await sendCDP$1("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: l.x,
      y: l.y
    }), await sleep(gaussianDelay(5, 15));
  return cursorX = a.x, cursorY = a.y, { success: !0 };
}, handleCDPKeypress = async (e) => {
  const { key: t, modifiers: s } = e, n = s ?? [], a = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  let o = 0;
  for (const m of n)
    o |= a[m] ?? 0;
  const r = {
    Enter: { code: "Enter", keyCode: 13 },
    Tab: { code: "Tab", keyCode: 9 },
    Escape: { code: "Escape", keyCode: 27 },
    Backspace: { code: "Backspace", keyCode: 8 },
    Delete: { code: "Delete", keyCode: 46 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
    PageUp: { code: "PageUp", keyCode: 33 },
    PageDown: { code: "PageDown", keyCode: 34 },
    Space: { code: "Space", keyCode: 32 }
  }[t], l = (r == null ? void 0 : r.code) ?? (t.length === 1 ? `Key${t.toUpperCase()}` : t), c = (r == null ? void 0 : r.keyCode) ?? t.charCodeAt(0);
  return await sendCDP$1("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: t,
    code: l,
    windowsVirtualKeyCode: c,
    nativeVirtualKeyCode: c,
    modifiers: o
  }), t.length === 1 && await sendCDP$1("Input.dispatchKeyEvent", {
    type: "char",
    text: t,
    key: t,
    code: l,
    windowsVirtualKeyCode: c,
    nativeVirtualKeyCode: c,
    modifiers: o
  }), await sendCDP$1("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: t,
    code: l,
    windowsVirtualKeyCode: c,
    nativeVirtualKeyCode: c,
    modifiers: o
  }), { success: !0 };
}, handleMouseMove = async (e) => {
  const { x: t, y: s } = e;
  if (!isAttached)
    return cursorX = t, cursorY = s, { success: !0 };
  const n = gaussianDelay(10, 20), a = generateBezierPath(cursorX, cursorY, t, s, n);
  for (const o of a)
    await sendCDP$1("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: o.x,
      y: o.y
    }), await sleep(gaussianDelay(5, 15));
  return cursorX = t, cursorY = s, { success: !0 };
}, api$1 = globalThis.chrome, sendCDP = async (e, t, s = {}) => api$1.debugger.sendCommand({ tabId: e }, t, s), findInertElement = async (e) => {
  var s;
  return (s = (await api$1.scripting.executeScript({
    target: { tabId: e },
    func: () => {
      const n = /* @__PURE__ */ new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "DETAILS", "SUMMARY"]), a = [], o = document.querySelectorAll("div, span, p, section, article, li, td, th, h1, h2, h3, h4, h5, h6");
      for (let i = 0; i < o.length && a.length < 30; i++) {
        const r = o[i], l = r.getBoundingClientRect();
        l.width < 10 || l.height < 10 || l.top < 0 || l.left < 0 || l.bottom > window.innerHeight || l.right > window.innerWidth || n.has(r.tagName) || r.closest("a, button, input, select, textarea, label") || r.getAttribute("role") === "button" || r.getAttribute("role") === "link" || r.onclick || r.getAttribute("onclick") || a.push({
          x: Math.round(l.left + l.width / 2),
          y: Math.round(l.top + l.height / 2)
        });
      }
      return a.length === 0 ? null : a[Math.floor(Math.random() * a.length)];
    },
    world: "MAIN"
  }))[0]) == null ? void 0 : s.result;
}, actionRandomPause = {
  name: "random_pause",
  execute: async () => {
    const e = gaussianDelay(800, 2e3);
    return await sleep(e), e;
  }
}, actionMicroScroll = {
  name: "micro_scroll",
  execute: async (e) => {
    const { attached: t } = getDebuggerState(), s = gaussianDelay(20, 60), n = Math.random() > 0.5 ? 1 : -1, a = performance.now();
    if (t) {
      const o = getCursorPosition();
      await sendCDP(e, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: o.x || 400,
        y: o.y || 400,
        deltaX: 0,
        deltaY: s * n
      }), await sleep(gaussianDelay(200, 500)), Math.random() > 0.4 && await sendCDP(e, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: o.x || 400,
        y: o.y || 400,
        deltaX: 0,
        deltaY: -s * n
      });
    } else
      await api$1.scripting.executeScript({
        target: { tabId: e },
        func: (o, i) => {
          window.scrollBy({ left: 0, top: o * i, behavior: "smooth" });
        },
        args: [s, n],
        world: "MAIN"
      }), await sleep(gaussianDelay(200, 500));
    return Math.round(performance.now() - a);
  }
}, actionCursorMove = {
  name: "cursor_move",
  execute: async (e) => {
    const t = performance.now(), s = await findInertElement(e);
    return s ? (await handleMouseMove({ x: s.x, y: s.y }), Math.round(performance.now() - t)) : (await sleep(gaussianDelay(500, 1e3)), Math.round(performance.now() - t));
  }
}, actionHoverInert = {
  name: "hover_inert",
  execute: async (e) => {
    const t = performance.now(), s = await findInertElement(e);
    return s ? (await handleMouseMove({ x: s.x, y: s.y }), await sleep(gaussianDelay(300, 800)), Math.round(performance.now() - t)) : (await sleep(gaussianDelay(300, 800)), Math.round(performance.now() - t));
  }
}, actionVariableScroll = {
  name: "variable_scroll",
  execute: async (e) => {
    const { attached: t } = getDebuggerState(), s = performance.now(), n = gaussianDelay(2, 4);
    for (let a = 0; a < n; a++) {
      const o = gaussianDelay(15, 40);
      if (t) {
        const i = getCursorPosition();
        await sendCDP(e, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: i.x || 400,
          y: i.y || 400,
          deltaX: 0,
          deltaY: o
        });
      } else
        await api$1.scripting.executeScript({
          target: { tabId: e },
          func: (i) => window.scrollBy({ left: 0, top: i, behavior: "smooth" }),
          args: [o],
          world: "MAIN"
        });
      await sleep(gaussianDelay(100, 300));
    }
    return Math.round(performance.now() - s);
  }
}, actionScrollBounce = {
  name: "scroll_bounce",
  execute: async (e) => {
    const { attached: t } = getDebuggerState(), s = performance.now(), n = gaussianDelay(80, 200);
    if (t) {
      const a = getCursorPosition();
      await sendCDP(e, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: a.x || 400,
        y: a.y || 400,
        deltaX: 0,
        deltaY: n
      }), await sleep(gaussianDelay(500, 1200)), await sendCDP(e, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: a.x || 400,
        y: a.y || 400,
        deltaX: 0,
        deltaY: -n
      });
    } else
      await api$1.scripting.executeScript({
        target: { tabId: e },
        func: (a) => window.scrollBy({ left: 0, top: a, behavior: "smooth" }),
        args: [n],
        world: "MAIN"
      }), await sleep(gaussianDelay(500, 1200)), await api$1.scripting.executeScript({
        target: { tabId: e },
        func: (a) => window.scrollBy({ left: 0, top: -a, behavior: "smooth" }),
        args: [n],
        world: "MAIN"
      });
    return await sleep(gaussianDelay(200, 400)), Math.round(performance.now() - s);
  }
}, actionIdleDrift = {
  name: "idle_drift",
  execute: async (e) => {
    const { attached: t } = getDebuggerState(), s = performance.now();
    if (!t)
      return await sleep(gaussianDelay(1e3, 2e3)), Math.round(performance.now() - s);
    const n = getCursorPosition(), a = gaussianDelay(3, 6);
    for (let o = 0; o < a; o++) {
      const i = gaussianDelay(-5, 5), r = gaussianDelay(-5, 5), l = Math.max(0, n.x + i), c = Math.max(0, n.y + r);
      await sendCDP(e, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: l,
        y: c
      }), await sleep(gaussianDelay(200, 400));
    }
    return Math.round(performance.now() - s);
  }
}, actionLongPause = {
  name: "long_pause",
  execute: async () => {
    const e = gaussianDelay(2e3, 5e3);
    return await sleep(e), e;
  }
}, POOLS = {
  light: [actionRandomPause, actionMicroScroll],
  moderate: [actionRandomPause, actionMicroScroll, actionCursorMove, actionHoverInert, actionVariableScroll],
  heavy: [
    actionRandomPause,
    actionMicroScroll,
    actionCursorMove,
    actionHoverInert,
    actionVariableScroll,
    actionScrollBounce,
    actionIdleDrift,
    actionLongPause
  ]
}, handleHumanize = async (e) => {
  const t = e.intensity ?? "moderate", s = await resolveTabId(e), n = POOLS[t], a = n[Math.floor(Math.random() * n.length)];
  log(`Humanize (${t}): executing ${a.name}`);
  const o = await a.execute(s);
  return log(`Humanize: ${a.name} completed in ${o}ms`), { action: a.name, duration_ms: o };
}, api = globalThis.chrome;
let connectionStatus = "disconnected", connectionPort = DEFAULT_PORT;
const RECONNECT_ALARM = "wolffish-reconnect";
let ws = null, heartbeatTimer = null;
const stopHeartbeat = () => {
  heartbeatTimer !== null && (clearInterval(heartbeatTimer), heartbeatTimer = null);
}, startHeartbeat = () => {
  stopHeartbeat(), heartbeatTimer = setInterval(() => {
    (ws == null ? void 0 : ws.readyState) === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" }));
  }, HEARTBEAT_INTERVAL_MS);
}, setStatus = (e) => {
  connectionStatus = e, log(`Connection status: ${e}`), api.runtime.sendMessage({ type: "status_update", status: e, port: connectionPort }).catch(() => {
  });
}, scheduleReconnect = () => {
  api.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.05 });
};
api.alarms.onAlarm.addListener((e) => {
  e.name === RECONNECT_ALARM && connectionStatus !== "connected" && connectWebSocket(connectionPort);
});
const connectWebSocket = async (e) => {
  ws && (ws.onopen = null, ws.onclose = null, ws.onerror = null, ws.onmessage = null, (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && ws.close(), ws = null), connectionPort = e;
  try {
    await fetch(`http://localhost:${e}`, { mode: "no-cors" });
  } catch {
    setStatus("disconnected"), scheduleReconnect();
    return;
  }
  setStatus("connecting"), log(`Connecting to ws://localhost:${e}`), ws = new WebSocket(`ws://localhost:${e}`), ws.onopen = () => {
    setStatus("connected"), api.alarms.clear(RECONNECT_ALARM), startHeartbeat(), log("Connected");
    const t = api.runtime.getManifest();
    sendToServer({ type: "extension_info", version: t.version }), sendToServer({ type: "get_conversations" });
  }, ws.onclose = () => {
    setStatus("disconnected"), stopHeartbeat(), log("Disconnected"), scheduleReconnect();
  }, ws.onerror = () => {
    log("WebSocket error");
  }, ws.onmessage = (t) => {
    try {
      const s = JSON.parse(t.data);
      if (s.type === "pong") return;
      if (s.type === "event") {
        handleWolffishEvent(s);
        return;
      }
      if (s.id && s.type) {
        handleCommand(s);
        return;
      }
    } catch (s) {
      logError("Failed to parse WebSocket message", s);
    }
  };
}, sendToServer = (e) => {
  (ws == null ? void 0 : ws.readyState) === WebSocket.OPEN && ws.send(JSON.stringify(e));
}, handleNavigate = async (e) => {
  const { url: t, waitUntil: s } = e, n = await resolveTabId(e), a = new Promise((i, r) => {
    const l = setTimeout(() => {
      api.webNavigation.onCompleted.removeListener(c), s ? r(new Error(`Navigation timed out waiting for '${s}'`)) : i();
    }, COMMAND_TIMEOUT_MS), c = (m) => {
      m.tabId === n && m.frameId === 0 && (clearTimeout(l), api.webNavigation.onCompleted.removeListener(c), i());
    };
    api.webNavigation.onCompleted.addListener(c);
  });
  await api.tabs.update(n, { url: t }), await a;
  const o = await api.tabs.get(n);
  return { url: o.url || t, title: o.title || "", tabId: n };
}, handleBack = async (e) => {
  const t = await resolveTabId(e);
  return await api.scripting.executeScript({
    target: { tabId: t },
    func: () => history.back()
  }), { success: !0 };
}, handleForward = async (e) => {
  const t = await resolveTabId(e);
  return await api.scripting.executeScript({
    target: { tabId: t },
    func: () => history.forward()
  }), { success: !0 };
}, handleReload = async (e) => {
  const { hard: t } = e, s = await resolveTabId(e);
  return await api.tabs.reload(s, { bypassCache: t ?? !1 }), { success: !0 };
}, handleTabsList = async (e) => {
  const { windowId: t } = e, s = t !== void 0 ? { windowId: t } : {};
  return {
    tabs: (await api.tabs.query(s)).map((a) => ({
      id: a.id,
      url: a.url || "",
      title: a.title || "",
      active: a.active,
      pinned: a.pinned,
      windowId: a.windowId
    }))
  };
}, handleTabOpen = async (e) => {
  const { url: t, active: s } = e, n = await api.tabs.create({ url: t, active: s ?? !0 });
  return {
    tabId: n.id,
    url: n.pendingUrl || n.url || t || ""
  };
}, handleTabClose = async (e) => {
  const { tabId: t } = e;
  return await api.tabs.remove(t), { success: !0 };
}, handleTabSwitch = async (e) => {
  const { tabId: t } = e;
  return await api.tabs.update(t, { active: !0 }), { success: !0 };
}, handleTabDuplicate = async (e) => {
  const { tabId: t } = e, s = await api.tabs.duplicate(t);
  if (!s)
    throw new Error(`Failed to duplicate tab ${t}`);
  return { tabId: s.id };
}, handleTabMove = async (e) => {
  const { tabId: t, index: s, windowId: n } = e, a = { index: s };
  return n !== void 0 && (a.windowId = n), await api.tabs.move(t, a), { success: !0 };
}, handleWindowsList = async () => ({
  windows: (await api.windows.getAll({ populate: !0 })).map((t) => {
    var s;
    return {
      id: t.id,
      focused: t.focused,
      tabs: ((s = t.tabs) == null ? void 0 : s.length) ?? 0,
      type: t.type || "normal",
      state: t.state || "normal"
    };
  })
}), handleWindowOpen = async (e) => {
  const { url: t, incognito: s, width: n, height: a } = e, o = {};
  return t !== void 0 && (o.url = t), s !== void 0 && (o.incognito = s), n !== void 0 && (o.width = n), a !== void 0 && (o.height = a), { windowId: (await api.windows.create(o)).id };
}, handleWindowClose = async (e) => {
  const { windowId: t } = e;
  return await api.windows.remove(t), { success: !0 };
}, handleWindowResize = async (e) => {
  const { windowId: t, width: s, height: n, left: a, top: o, state: i } = e, r = {};
  return s !== void 0 && (r.width = s), n !== void 0 && (r.height = n), a !== void 0 && (r.left = a), o !== void 0 && (r.top = o), i !== void 0 && (r.state = i), await api.windows.update(t, r), { success: !0 };
}, handleScreenshot = async (e) => {
  const { format: t, quality: s, fullPage: n, selector: a } = e;
  if (a || n) {
    const u = await resolveTabId(e);
    return await ensureContentScriptInjected(u), (await sendToContentScript(u, {
      source: "service-worker",
      target: "content-script",
      payload: {
        id: crypto.randomUUID(),
        type: WolffishCommands.BROWSER_SCREENSHOT,
        params: e
      }
    })).data;
  }
  const o = t === "jpeg" ? "jpeg" : "png", i = { format: o };
  o === "jpeg" && s !== void 0 && (i.quality = s);
  const r = await api.tabs.captureVisibleTab(null, i), l = await resolveTabId(e), c = await api.tabs.get(l), m = await api.windows.get(c.windowId);
  return {
    image: r,
    width: m.width || 0,
    height: m.height || 0
  };
}, handlePdf = async (e) => {
  if (isFirefox())
    throw new Error("PDF generation is not supported on Firefox");
  const t = await resolveTabId(e);
  await api.debugger.attach({ tabId: t }, "1.3");
  try {
    return { data: (await api.debugger.sendCommand({ tabId: t }, "Page.printToPDF", {})).data };
  } finally {
    await api.debugger.detach({ tabId: t }).catch(() => {
    });
  }
}, handleCookiesGet = async (e) => {
  const { domain: t, name: s } = e, n = { domain: t };
  return s !== void 0 && (n.name = s), {
    cookies: (await api.cookies.getAll(n)).map((o) => ({
      name: o.name,
      value: o.value,
      domain: o.domain,
      path: o.path,
      expires: o.expirationDate || -1,
      httpOnly: o.httpOnly,
      secure: o.secure
    }))
  };
}, handleCookiesSet = async (e) => {
  const { url: t, name: s, value: n, domain: a, path: o, expires: i, httpOnly: r, secure: l } = e, c = { url: t, name: s, value: n };
  return a !== void 0 && (c.domain = a), o !== void 0 && (c.path = o), i !== void 0 && (c.expirationDate = i), r !== void 0 && (c.httpOnly = r), l !== void 0 && (c.secure = l), await api.cookies.set(c), { success: !0 };
}, handleCookiesRemove = async (e) => {
  const { url: t, name: s } = e;
  return await api.cookies.remove({ url: t, name: s }), { success: !0 };
}, handleDownload = async (e) => {
  const { url: t, filename: s } = e, n = { url: t };
  return s !== void 0 && (n.filename = s), { downloadId: await api.downloads.download(n) };
}, handleExecuteJs = async (params) => {
  var e;
  const { code, world } = params, tabId = await resolveTabId(params), results = await api.scripting.executeScript({
    target: { tabId },
    func: (source) => eval(source),
    args: [code],
    world: world || "ISOLATED"
  });
  return { result: (e = results[0]) == null ? void 0 : e.result };
}, handleWaitForNavigation = async (e) => {
  const { timeout: t } = e, s = await resolveTabId(e), n = t ?? COMMAND_TIMEOUT_MS, a = await api.tabs.get(s).then((o) => o.url || "").catch(() => "");
  return new Promise((o) => {
    let i = !1;
    const r = (u, A) => {
      i || (i = !0, clearTimeout(l), api.webNavigation.onCompleted.removeListener(c), api.tabs.onUpdated.removeListener(m), o({ url: u, title: A }));
    }, l = setTimeout(() => {
      api.tabs.get(s).then((u) => r(u.url || "", u.title || "")).catch(() => r(a, ""));
    }, n), c = (u) => {
      u.tabId === s && u.frameId === 0 && api.tabs.get(s).then((A) => r(A.url || u.url, A.title || "")).catch(() => r(u.url, ""));
    }, m = (u, A) => {
      u === s && A.url && A.url !== a && api.tabs.get(s).then((_) => r(_.url || A.url, _.title || "")).catch(() => r(A.url, ""));
    };
    api.webNavigation.onCompleted.addListener(c), api.tabs.onUpdated.addListener(m);
  });
}, MAX_WAIT_SLEEP_MS = 3e5, handleWait = async (e) => {
  const t = e, s = t.timeout_ms ?? t.timeout ?? t.ms, n = t.type ?? (t.selector ? "selector" : "timeout");
  if (n === "navigation")
    return handleWaitForNavigation({ timeout: s, tabId: t.tabId });
  if (n === "selector" || n === "network_idle") {
    if (n === "selector" && !t.selector)
      throw new Error("selector is required for type=selector");
    const o = await resolveTabId(t);
    await ensureContentScriptInjected(o);
    const i = {
      id: generateId(),
      type: n === "selector" ? WolffishCommands.BROWSER_WAIT_FOR : WolffishCommands.BROWSER_WAIT_FOR_NETWORK_IDLE,
      params: n === "selector" ? { selector: t.selector, timeout: s, visible: t.visible, tabId: o } : { timeout: s, tabId: o }
    }, r = await sendToContentScript(o, {
      source: "service-worker",
      target: "content-script",
      payload: i
    });
    if (!(r != null && r.success))
      throw new Error((r == null ? void 0 : r.error) ?? `${n} wait failed`);
    return r.data;
  }
  const a = Math.max(0, Math.min(s ?? 1e3, MAX_WAIT_SLEEP_MS));
  return await new Promise((o) => setTimeout(o, a)), { waited: a };
}, handleNotify = async (e) => {
  const { title: t, message: s, iconUrl: n } = e;
  return { notificationId: await api.notifications.create("", {
    type: "basic",
    title: t,
    message: s,
    iconUrl: n || api.runtime.getURL("icon-128.png")
  }) };
}, handleGetUrl = async (e) => {
  const t = await resolveTabId(e), s = await api.tabs.get(t);
  return { url: s.url || "", title: s.title || "" };
}, SERVICE_WORKER_HANDLERS = {
  [WolffishCommands.BROWSER_NAVIGATE]: handleNavigate,
  [WolffishCommands.BROWSER_BACK]: handleBack,
  [WolffishCommands.BROWSER_FORWARD]: handleForward,
  [WolffishCommands.BROWSER_RELOAD]: handleReload,
  [WolffishCommands.BROWSER_TABS_LIST]: handleTabsList,
  [WolffishCommands.BROWSER_TAB_OPEN]: handleTabOpen,
  [WolffishCommands.BROWSER_TAB_CLOSE]: handleTabClose,
  [WolffishCommands.BROWSER_TAB_SWITCH]: handleTabSwitch,
  [WolffishCommands.BROWSER_TAB_DUPLICATE]: handleTabDuplicate,
  [WolffishCommands.BROWSER_TAB_MOVE]: handleTabMove,
  [WolffishCommands.BROWSER_WINDOWS_LIST]: handleWindowsList,
  [WolffishCommands.BROWSER_WINDOW_OPEN]: handleWindowOpen,
  [WolffishCommands.BROWSER_WINDOW_CLOSE]: handleWindowClose,
  [WolffishCommands.BROWSER_WINDOW_RESIZE]: handleWindowResize,
  [WolffishCommands.BROWSER_SCREENSHOT]: handleScreenshot,
  [WolffishCommands.BROWSER_PDF]: handlePdf,
  [WolffishCommands.BROWSER_COOKIES_GET]: handleCookiesGet,
  [WolffishCommands.BROWSER_COOKIES_SET]: handleCookiesSet,
  [WolffishCommands.BROWSER_COOKIES_REMOVE]: handleCookiesRemove,
  [WolffishCommands.BROWSER_DOWNLOAD]: handleDownload,
  [WolffishCommands.BROWSER_EXECUTE_JS]: handleExecuteJs,
  [WolffishCommands.BROWSER_WAIT]: handleWait,
  [WolffishCommands.BROWSER_WAIT_FOR_NAVIGATION]: handleWaitForNavigation,
  [WolffishCommands.BROWSER_NOTIFY]: handleNotify,
  [WolffishCommands.BROWSER_GET_URL]: handleGetUrl,
  [WolffishCommands.DEBUGGER_ATTACH]: handleDebuggerAttach,
  [WolffishCommands.DEBUGGER_DETACH]: handleDebuggerDetach,
  [WolffishCommands.DEBUGGER_STATUS]: handleDebuggerStatus,
  [WolffishCommands.BROWSER_MOUSE_MOVE]: handleMouseMove,
  [WolffishCommands.HUMANIZE]: handleHumanize
}, CDP_HANDLERS = {
  [WolffishCommands.BROWSER_CLICK]: handleCDPClick,
  [WolffishCommands.BROWSER_TYPE]: handleCDPType,
  [WolffishCommands.BROWSER_SCROLL]: handleCDPScroll,
  [WolffishCommands.BROWSER_HOVER]: handleCDPHover,
  [WolffishCommands.BROWSER_KEYPRESS]: handleCDPKeypress
}, sendResponseToServer = (e) => {
  sendToServer(e);
}, handleCommand = async (e) => {
  log("←", e.type, e.params);
  try {
    let t;
    if (SERVICE_WORKER_COMMANDS.has(e.type)) {
      const s = SERVICE_WORKER_HANDLERS[e.type];
      if (!s)
        t = makeErrorResponse(e.id, `No handler for command: ${e.type}`);
      else {
        const n = await withTimeout(s(e.params));
        t = makeResponse(e.id, n);
      }
    } else if (CONTENT_SCRIPT_COMMANDS.has(e.type)) {
      if (getDebuggerState().attached && DEBUGGER_ROUTABLE_COMMANDS.has(e.type)) {
        const o = CDP_HANDLERS[e.type];
        if (o)
          try {
            const i = await withTimeout(o(e.params));
            t = makeResponse(e.id, i), log("→", e.type, "success (CDP)"), sendResponseToServer(t);
            return;
          } catch (i) {
            log("CDP fallback:", e.type, i instanceof Error ? i.message : String(i));
          }
      }
      const n = await resolveTabId(e.params);
      await ensureContentScriptInjected(n), t = await withTimeout(
        sendToContentScript(n, {
          source: "service-worker",
          target: "content-script",
          payload: e
        })
      );
    } else
      t = makeErrorResponse(e.id, `Unknown command: ${e.type}`);
    log("→", e.type, t.success ? "success" : t.error), sendResponseToServer(t);
  } catch (t) {
    const s = t instanceof Error ? t.message : String(t), n = makeErrorResponse(e.id, s);
    log("→", e.type, "error:", n.error), sendResponseToServer(n);
  }
}, CACHE_MAX_CONVERSATIONS = 50, CACHE_MAX_EVENTS = 500, cache = {
  saveConversations(e) {
    const t = e.slice(0, CACHE_MAX_CONVERSATIONS);
    api.storage.local.set({ "wf:conversations": t }).catch(() => {
    });
  },
  saveActive(e) {
    api.storage.local.set({ "wf:active": e }).catch(() => {
    });
  },
  saveEvents(e, t) {
    const s = t.slice(0, CACHE_MAX_EVENTS);
    api.storage.local.set({ [`wf:events:${e}`]: s }).catch(() => {
    });
  },
  async loadAll() {
    try {
      const e = await api.storage.local.get(["wf:conversations", "wf:active"]), t = e["wf:conversations"] ?? [], s = e["wf:active"] ?? null;
      let n = [];
      return s && (n = (await api.storage.local.get([`wf:events:${s}`]))[`wf:events:${s}`] ?? []), { conversations: t, active: s, events: n };
    } catch {
      return { conversations: [], active: null, events: [] };
    }
  },
  async loadEvents(e) {
    try {
      return (await api.storage.local.get([`wf:events:${e}`]))[`wf:events:${e}`] ?? [];
    } catch {
      return [];
    }
  }
};
let cachedEvents = [], cachedConversations = [], activeConversationId = null, activeConversationTitle = null, cacheRestored = !1;
const handleWolffishEvent = (e) => {
  if (e.event === "port_update") {
    const { port: t } = e.data;
    log(`Port update received: ${t}`), wolffishConnectionStorage.set({ port: t });
    return;
  }
  if (e.event === "extension_reload") {
    log("Received reload command from Wolffish"), api.runtime.reload();
    return;
  }
  if (e.event === "events_sync") {
    const t = e.data;
    activeConversationId = t.conversationId, activeConversationTitle = t.title ?? null, cachedEvents = (t.events ?? []).slice().reverse(), cache.saveActive(activeConversationId), cache.saveEvents(activeConversationId, cachedEvents), api.runtime.sendMessage({ payload: { event: "events_sync", data: e.data } }).catch(() => {
    });
    return;
  }
  if (e.event === "event_logged") {
    const t = e.data;
    cachedEvents.unshift(t), activeConversationId && cache.saveEvents(activeConversationId, cachedEvents), api.runtime.sendMessage({ payload: { event: "event_logged", data: t } }).catch(() => {
    });
    return;
  }
  if (e.event === "conversations_list") {
    cachedConversations = e.data, cache.saveConversations(cachedConversations), api.runtime.sendMessage({ payload: { event: "conversations_list", data: e.data } }).catch(() => {
    });
    for (const t of cachedConversations)
      sendToServer({ type: "get_conversation_events", conversationId: t.conversationId });
    return;
  }
  if (e.event === "conversation_events") {
    const t = e.data;
    cache.saveEvents(t.conversationId, (t.events ?? []).slice().reverse()), api.runtime.sendMessage({ payload: { event: "conversation_events", data: t } }).catch(() => {
    });
    return;
  }
};
api.runtime.onMessage.addListener((e, t, s) => {
  if (e.type === "get_connection_status") {
    const n = ws && ws.readyState === WebSocket.OPEN ? "connected" : ws && ws.readyState === WebSocket.CONNECTING ? "connecting" : "disconnected";
    return n !== connectionStatus && (connectionStatus = n), s({ status: connectionStatus, port: connectionPort }), !0;
  }
  if (e.type === "get_events")
    return sendToServer({ type: "get_conversations" }), cachedConversations.length > 0 || activeConversationId ? s({
      events: cachedEvents,
      conversations: cachedConversations,
      activeConversation: activeConversationId,
      activeConversationTitle
    }) : cache.loadAll().then((n) => {
      cachedConversations = n.conversations, activeConversationId = n.active, cachedEvents = n.events, s({
        events: cachedEvents,
        conversations: cachedConversations,
        activeConversation: activeConversationId,
        activeConversationTitle
      }), api.runtime.sendMessage({ payload: { event: "conversations_list", data: cachedConversations } }).catch(() => {
      });
    }), !0;
  if (e.type === "get_conversation_events" && e.conversationId) {
    const n = e.conversationId;
    return sendToServer({ type: "get_conversation_events", conversationId: n }), cache.loadEvents(n).then((a) => {
      cachedEvents = a, api.runtime.sendMessage({ payload: { event: "conversation_events", data: { conversationId: n, events: a } } }).catch(() => {
      }), s({ events: a });
    }), !0;
  }
  return !1;
});
const startConnection = async () => {
  connectionPort = (await wolffishConnectionStorage.get().catch(() => ({ port: DEFAULT_PORT }))).port, connectWebSocket(connectionPort);
};
api.runtime.onInstalled.addListener(async () => {
  log("Extension installed"), api.sidePanel && api.sidePanel.setPanelBehavior({ openPanelOnActionClick: !0 }), await startConnection();
});
api.runtime.onStartup.addListener(async () => {
  log("Extension started"), api.sidePanel && api.sidePanel.setPanelBehavior({ openPanelOnActionClick: !0 }), await startConnection();
});
wolffishConnectionStorage.subscribe(() => {
  const e = wolffishConnectionStorage.getSnapshot();
  e && e.port !== connectionPort && (log(`Port changed to ${e.port}`), api.alarms.clear(RECONNECT_ALARM), connectWebSocket(e.port));
});
cache.loadAll().then((e) => {
  cacheRestored || (cachedConversations = e.conversations, activeConversationId = e.active, cachedEvents = e.events, cacheRestored = !0, log(`Cache restored: ${e.conversations.length} conversations, ${e.events.length} events`));
}).catch(() => {
});
startConnection().catch((e) => logError("Failed to start connection:", e));
log("Service worker loaded");
