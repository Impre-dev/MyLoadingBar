// ==UserScript==
// @name           MyLoadingBar
// @version        1.0.0
// @description    Loading bar fluide — vraie progression (bytes) + fallback paliers + 100% garanti
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    function init() {
        if (window.__myLoadingBarInit) return;
        if (!window.gBrowser || !gBrowser.tabContainer) {
            setTimeout(init, 500);
            return;
        }
        window.__myLoadingBarInit = true;

        const TAG = '[MyLoadingBar]';

        // ════════════════════════════════════════════════════════════════
        //  CONFIG
        // ════════════════════════════════════════════════════════════════
        const CONFIG = {
            startProgress: 5,          // Largeur initiale au STATE_START
            minProgress: 15,           // Palier fallback 1 (apres 500ms sans progress reelle)
            pendingProgress: 35,       // Palier fallback 2 (pendingicon detecte)
            downloadingProgress: 70,   // Palier fallback 3 (progress detecte)
            maxRealProgress: 95,       // Plafond progression reelle (garde 5% pour la completion)
            debounceMs: 150,           // Delai avant completion sur STATE_STOP (anti clignotement)
            completeHoldMs: 200,       // Maintien a 100% avant fade
            fadeDuration: 300,         // Duree du fade out (doit matcher la transition CSS)
            fallbackTimerMs: 500,      // Si pas de progression reelle apres ce delai → paliers
        };

        // ════════════════════════════════════════════════════════════════
        //  STATE — par browser (WeakMap = auto-cleanup GC)
        //  { loading, progress, hasRealProgress, completionTimer, fallbackTimer }
        // ════════════════════════════════════════════════════════════════
        const states = new WeakMap();

        function getState(browser, create = false) {
            let s = states.get(browser);
            if (!s && create) {
                s = {
                    loading: false,
                    progress: 0,
                    hasRealProgress: false,
                    completionTimer: null,
                    fallbackTimer: null,
                };
                states.set(browser, s);
            }
            return s;
        }

        function clearTimers(s) {
            if (!s) return;
            if (s.completionTimer) { clearTimeout(s.completionTimer); s.completionTimer = null; }
            if (s.fallbackTimer) { clearTimeout(s.fallbackTimer); s.fallbackTimer = null; }
        }

        // ════════════════════════════════════════════════════════════════
        //  BAR ELEMENT — un seul element DOM, reparente dynamiquement
        // ════════════════════════════════════════════════════════════════
        let bar = null;

        function getBar() {
            if (!bar || !bar.isConnected) {
                bar = document.createElement('div');
                bar.id = 'uc-loadingbar';
            }
            return bar;
        }

        function getActiveContainer() {
            return document.querySelector('.browserSidebarContainer.deck-selected');
        }

        function ensureBarPosition() {
            const b = getBar();
            const container = getActiveContainer();
            if (container && b.parentElement !== container) {
                container.appendChild(b);
            }
        }

        function isSelected(browser) {
            return browser === gBrowser.selectedBrowser;
        }

        // ════════════════════════════════════════════════════════════════
        //  RENDERING
        // ════════════════════════════════════════════════════════════════
        function showBar(browser, pct) {
            const s = getState(browser, true);
            clearTimers(s);
            s.loading = true;
            s.progress = pct;
            s.hasRealProgress = false;

            if (isSelected(browser)) {
                ensureBarPosition();
                const b = getBar();
                b.style.opacity = '1';
                b.style.width = pct + '%';
            }
        }

        function updateProgress(browser, pct) {
            const s = getState(browser);
            if (!s || !s.loading) return;
            // La progression ne recule jamais
            if (pct > s.progress) {
                s.progress = pct;
            }
            s.hasRealProgress = true;

            if (isSelected(browser)) {
                const b = getBar();
                b.style.width = s.progress + '%';
            }
        }

        function startCompletion(browser) {
            const s = getState(browser);
            if (!s) return;
            s.loading = false;

            if (isSelected(browser)) {
                const b = getBar();
                // Phase 1 : width → 100%
                b.style.width = '100%';

                // Phase 2 : apres hold → fade opacity
                s.completionTimer = setTimeout(() => {
                    if (!states.has(browser)) return;
                    b.style.opacity = '0';

                    // Phase 3 : apres fade → reset width a 0
                    s.completionTimer = setTimeout(() => {
                        if (!states.has(browser)) return;
                        b.style.width = '0%';
                        s.completionTimer = null;
                    }, CONFIG.fadeDuration);
                }, CONFIG.completeHoldMs);
            }
        }

        function hideBar() {
            const b = getBar();
            b.style.opacity = '0';
            b.style.width = '0%';
        }

        // ════════════════════════════════════════════════════════════════
        //  PROGRESS LISTENER — vraie progression en bytes
        // ════════════════════════════════════════════════════════════════
        const progressListener = {
            onStateChange(browser, webProgress, request, stateFlags, status) {
                if (!webProgress.isTopLevel) return;

                const WPL = Ci.nsIWebProgressListener;
                const isStart = stateFlags & WPL.STATE_START;
                const isStop = stateFlags & WPL.STATE_STOP;

                if (isStart) {
                    showBar(browser, CONFIG.startProgress);

                    // Fallback : si pas de progression reelle apres X ms → palier min
                    const s = getState(browser);
                    s.fallbackTimer = setTimeout(() => {
                        const st = getState(browser);
                        if (st && st.loading && !st.hasRealProgress) {
                            updateProgress(browser, CONFIG.minProgress);
                        }
                    }, CONFIG.fallbackTimerMs);
                }

                if (isStop) {
                    const s = getState(browser);
                    if (!s || !s.loading) return;
                    if (s.fallbackTimer) { clearTimeout(s.fallbackTimer); s.fallbackTimer = null; }

                    // Debounce : attendre avant de completer (anti redirect clignotement)
                    s.completionTimer = setTimeout(() => {
                        const st = getState(browser);
                        if (st) st.completionTimer = null;
                        startCompletion(browser);
                    }, CONFIG.debounceMs);
                }
            },

            onProgressChange(browser, webProgress, request,
                             curSelf, maxSelf, curTotal, maxTotal) {
                if (!webProgress.isTopLevel) return;
                if (maxTotal > 0) {
                    const pct = Math.min(
                        CONFIG.maxRealProgress,
                        (curTotal / maxTotal) * 100
                    );
                    updateProgress(browser, pct);
                }
            },
        };

        gBrowser.addTabsProgressListener(progressListener);

        // ════════════════════════════════════════════════════════════════
        //  TAB EVENTS
        // ════════════════════════════════════════════════════════════════

        // Changement d'onglet → afficher/cacher la barre selon l'etat du nouvel onglet
        gBrowser.tabContainer.addEventListener('TabSelect', () => {
            const browser = gBrowser.selectedBrowser;
            const s = getState(browser);

            if (s && s.loading) {
                // L'onglet selectionne charge → afficher sa progression
                ensureBarPosition();
                const b = getBar();
                b.style.opacity = '1';
                b.style.width = s.progress + '%';
            } else {
                hideBar();
            }
        });

        // Attributs onglet modifies → paliers fallback (si pas de progress reelle)
        gBrowser.tabContainer.addEventListener('TabAttrModified', (e) => {
            const tab = e.target;
            if (!tab.selected) return;

            const browser = tab.linkedBrowser;
            const s = getState(browser);
            if (!s || !s.loading || s.hasRealProgress) return;

            // Paliers uniquement si aucune progression reelle recue
            if (tab.hasAttribute('progress')) {
                updateProgress(browser, CONFIG.downloadingProgress);
            } else if (tab.hasAttribute('pendingicon')) {
                updateProgress(browser, CONFIG.pendingProgress);
            }
        });

        // Fermeture d'onglet → cleanup
        gBrowser.tabContainer.addEventListener('TabClose', (e) => {
            const browser = e.target.linkedBrowser;
            const s = getState(browser);
            if (s) {
                clearTimers(s);
                states.delete(browser);
            }
        });

        console.log(TAG, 'initialized ✓ — progress listener actif');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    }
})();
